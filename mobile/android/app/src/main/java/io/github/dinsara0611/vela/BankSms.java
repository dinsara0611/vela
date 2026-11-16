package io.github.dinsara0611.vela;

import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Decides whether a bank SMS or bank-app notification is a transaction worth keeping, using the same rules as
 * the parser in the app (app.js parseBankSms): a known bank, no OTPs, promotions, login or security alerts,
 * announcements, reminders or failed payments, transaction wording, and an amount that isn't a balance.
 * The app does the full reading and always asks before adding. Pure Java (no Android classes) so it is unit-tested.
 */
final class BankSms {
    private BankSms() {}

    static final class Info {
        final String direction; // "in", "out", "atm" or "reversal"
        final String amount;    // as written, e.g. "2,500.00"
        final String currency;  // "LKR" or "USD"
        final String bank;

        Info(String direction, String amount, String currency, String bank) {
            this.direction = direction;
            this.amount = amount;
            this.currency = currency;
            this.bank = bank;
        }

        /** The amount as a number (commas removed), or -1. */
        double value() {
            try {
                return Double.parseDouble(amount.replace(",", ""));
            } catch (Exception e) {
                return -1;
            }
        }
    }

    private static final Pattern AMOUNT = Pattern.compile("(?i)(LKR|SLR|Rs\\.?|USD|US\\$)\\s*([0-9]{1,3}(?:,[0-9]{3})+(?:\\.[0-9]{1,2})?|[0-9]+(?:\\.[0-9]{1,2})?)");
    private static final Pattern BALANCE_BEFORE = Pattern.compile("(?i)(bal(ance)?|avl|avail(able)?|a/?v ?bal|limit|outstanding|o/s|current bal|ledger)[^0-9]{0,18}$");
    static final Pattern IGNORE = Pattern.compile(
        "(?i)\\b(otp|one[- ]?time (pass(word|code)?|pin)|verification code|security code|passcode|auth(entication)? code"
        + "|declined|was not successful|unsuccessful|failed|rejected|could not be (processed|completed)|insufficient (funds|balance)"
        + "|log(ged)?[- ]?in|sign(ed)?[- ]?in|login attempt|new device|password (was )?changed|pin (was )?changed"
        + "|security (alert|warning)|beware of|scheduled maintenance|system maintenance|will be unavailable|temporarily unavailable"
        + "|offer|discount|cashback|win|congratulations|apply now|instalment plan|promo"
        + "|will be debited|is due on|payment due|due date|minimum (payment|due)|reminder)\\b|\\d+ ?% ?off");
    private static final Pattern REVERSAL = Pattern.compile("(?i)\\b(revers(al|ed)|reverted|void(ed)?|cancell?ed transaction|transaction cancell?ed)\\b");
    private static final Pattern ATM = Pattern.compile("(?i)\\b(atm|cash withdrawal|cash wdl|withdrawn at|cdm)\\b");
    private static final Pattern IN = Pattern.compile("(?i)\\b(credited|credit of|deposited|deposit of|received|refund(ed)?|salary)\\b");
    private static final Pattern OUT_WORDS = Pattern.compile("(?i)\\b(debited|purchase|spent|withdrawn|deducted|charged)\\b");
    private static final Pattern OUT = Pattern.compile("(?i)\\b(debited|debit of|withdrawn|deducted|charged|purchase|purchased|spent|pos|paid|payment|transfer(red)?|sent|card (was )?used|fee|charges?)\\b");

    private static final String[][] BANKS = {
        { "(?i)^(combank|com ?bank|commercial|cbc|combnk)", "(?i)\\b(combank|com ?bank|commercial bank)\\b", "Commercial Bank" },
        { "(?i)^boc\\b|bankofceylon", "(?i)\\bbank of ceylon\\b", "BOC" },
        { "(?i)^hnb\\b", "(?i)\\bhatton national\\b", "HNB" },
        { "(?i)^sampath", "(?i)\\bsampath bank\\b", "Sampath Bank" },
        { "(?i)^people'?s", "(?i)\\bpeople'?s bank\\b", "People's Bank" },
        { "(?i)^nsb\\b", "(?i)\\bnational savings bank\\b", "NSB" },
        { "(?i)^(ntb|nations)", "(?i)\\bnations trust\\b", "Nations Trust" },
        { "(?i)^seylan", "(?i)\\bseylan\\b", "Seylan Bank" },
        { "(?i)^dfcc", "(?i)\\bdfcc\\b", "DFCC" },
        { "(?i)^ndb\\b", "(?i)\\bndb bank\\b", "NDB" },
        { "(?i)^(pabc|panasia)", "(?i)\\bpan asia bank\\b", "Pan Asia Bank" },
        { "(?i)^amana", "(?i)\\bamana bank\\b", "Amana Bank" }
    };

    /**
     * Commercial Bank of Ceylon apps (Sri Lanka), package names checked on the bank's Google Play developer page.
     * Vela only listens to the ones the user picks.
     */
    static final String[][] BANK_APPS = {
        { "combank.com.combankdigital", "ComBank Digital" },
        { "net.combank.passbook", "ComBank ePassbook" },
        { "com.euronetindia.combankqpluscustomer", "ComBank Q+" },
        { "com.kashmi.bank", "FLASH Digital Banking" }
    };

    static boolean isBankApp(String pkg) {
        if (pkg == null) return false;
        for (String[] a : BANK_APPS) if (a[0].equals(pkg)) return true;
        return false;
    }

    /** The bank name, or null when the sender and text don't belong to a known bank. */
    static String bankName(String address, String body) {
        String a = address == null ? "" : address.replaceAll("[^A-Za-z']", "");
        for (String[] b : BANKS) if (Pattern.compile(b[0]).matcher(a).find()) return b[2];
        for (String[] b : BANKS) if (body != null && Pattern.compile(b[1]).matcher(body).find()) return b[2];
        return null;
    }

    /** Null when the message isn't a bank transaction. */
    static Info parse(String address, String body) {
        return parse(address, body, null);
    }

    /** As above; bankOverride is set for notifications from a verified bank app. */
    static Info parse(String address, String body, String bankOverride) {
        if (body == null) return null;
        String text = body.replaceAll("\\s+", " ").trim();
        if (text.isEmpty() || IGNORE.matcher(text).find()) return null;
        String bank = bankOverride != null ? bankOverride : bankName(address, text);
        if (bank == null) return null;
        Matcher m = AMOUNT.matcher(text);
        String amount = null;
        String cur = "LKR";
        while (m.find()) {
            String before = text.substring(Math.max(0, m.start() - 30), m.start());
            if (BALANCE_BEFORE.matcher(before).find()) continue; // a balance or a limit, not what moved
            amount = m.group(2);
            cur = m.group(1).toUpperCase(Locale.ROOT).startsWith("US") ? "USD" : "LKR";
            break;
        }
        if (amount == null) return null;
        String dir;
        if (REVERSAL.matcher(text).find()) dir = "reversal";
        else if (ATM.matcher(text).find()) dir = "atm";
        else if (IN.matcher(text).find() && !OUT_WORDS.matcher(text).find()) dir = "in";
        else if (OUT.matcher(text).find()) dir = "out";
        else return null;
        return new Info(dir, amount, cur, bank);
    }

    /**
     * Whether an SMS and a notification are likely the same transaction, so only one Vela notification is shown.
     * Only across different sources (two SMS with the same amount are two purchases), same bank, direction,
     * currency and amount, within the window. The app makes the final decision with more detail.
     */
    static boolean likelySame(Info a, String sourceA, long timeA, Info b, String sourceB, long timeB, long windowMs) {
        if (a == null || b == null || sourceA == null || sourceA.equals(sourceB)) return false;
        return a.bank.equals(b.bank) && a.direction.equals(b.direction) && a.currency.equals(b.currency)
            && Math.abs(a.value() - b.value()) < 0.005 && Math.abs(timeA - timeB) <= windowMs;
    }

    /** Text that says the notification's content is hidden (lock screen or app setting): nothing to read. */
    static boolean looksHidden(String text) {
        if (text == null || text.trim().isEmpty()) return true;
        return Pattern.compile("(?i)(contents? hidden|sensitive (notification )?content|hidden content|new notification|tap to view|you have (a )?new (message|notification|alert))").matcher(text).find()
            && !AMOUNT.matcher(text).find();
    }
}
