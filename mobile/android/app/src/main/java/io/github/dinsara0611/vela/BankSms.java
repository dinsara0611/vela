package io.github.dinsara0611.vela;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Decides whether an SMS is a bank transaction worth keeping while Vela is closed. It follows the reader in the app
 * (app.js parseBankSms) rule for rule: the same banks, the same things that are never used (one-time codes, failed
 * payments, login alerts, reminders, statements, promotions, balance messages) and the same idea of which number is
 * the amount. tests/sms-corpus.tsv is read by the tests of both, so they cannot drift apart.
 * The app does the full reading and always asks before adding. Pure Java (no Android classes) so it is unit-tested.
 */
final class BankSms {
    private BankSms() {}

    static final class Info {
        final String direction; // "in", "out", "atm", "reversal" or "cardpay" (a payment to the user's own card)
        final String amount;    // as written, e.g. "2,500.00"
        final String currency;  // "LKR", "USD", ...
        final String bank;

        Info(String direction, String amount, String currency, String bank) {
            this.direction = direction;
            this.amount = amount;
            this.currency = currency;
            this.bank = bank;
        }

        /** The amount as a number (commas removed), or -1. */
        double value() {
            return number(amount);
        }
    }

    private static Pattern ci(String re) { return Pattern.compile(re, Pattern.CASE_INSENSITIVE); }
    private static Pattern lc(String re) { return Pattern.compile(re); } // for text that is already lower case
    private static boolean has(Pattern p, String s) { return p.matcher(s).find(); }
    private static int at(Pattern p, String s) { Matcher m = p.matcher(s); return m.find() ? m.start() : -1; }

    private static double number(String written) {
        try {
            return Double.parseDouble(written.replace(",", ""));
        } catch (Exception e) {
            return -1;
        }
    }

    // ---- Who sent it (app.js SMS_BANKS): name, sender ID (letters only), wording in the text ----
    private static final Object[][] BANKS = {
        { "Commercial Bank", ci("^(combank|combnk|commercialb|cbc$)"), ci("\\b(combank|com ?bank|commercial bank)\\b") },
        { "Sampath Bank", ci("^(sampath|samp(cc|txn|bank))"), ci("\\bsampath\\b") },
        { "HNB", ci("^hnb"), ci("\\b(hnb|hatton national)\\b") },
        { "BOC", ci("^(boc$|boc(sl|bank|alert|smart)|bankofceylon)"), ci("\\b(boc|bank of ceylon)\\b") },
        { "People's Bank", ci("^(peoplesb|peoplebank|peoples$|pbank$|pplbank)"), ci("\\bpeople'?s bank\\b") },
        { "NSB", ci("^nsb"), ci("\\b(nsb|national savings bank)\\b") },
        { "Nations Trust", ci("^(ntb|nationstrust|nations$|amex)"), ci("\\b(ntb|nations trust|american express|amex)\\b") },
        { "NDB", ci("^ndb"), ci("\\b(ndb|national development bank)\\b") },
        { "Seylan Bank", ci("^seylan"), ci("\\bseylan\\b") },
        { "DFCC", ci("^dfcc"), ci("\\bdfcc\\b") },
        { "Pan Asia Bank", ci("^(pabc|panasia)"), ci("\\b(pabc|pan asia)\\b") },
        { "Union Bank", ci("^(unionb|ubc$)"), ci("\\bunion bank\\b") },
        { "Amana Bank", ci("^amana"), ci("\\bamana bank\\b") },
        { "Cargills Bank", ci("^cargillsb"), ci("\\bcargills bank\\b") },
        { "HSBC", ci("^hsbc"), ci("\\bhsbc\\b") },
        { "Standard Chartered", ci("^(scb|stanchart|standardchart)"), ci("\\b(standard chartered|stanchart)\\b") },
        { "MCB", ci("^mcb"), ci("\\bmcb bank\\b") },
        { "SDB", ci("^(sdb|sanasa)"), ci("\\b(sdb bank|sanasa development)\\b") },
        { "RDB", ci("^(rdb|pradeshiya)"), ci("\\b(rdb bank|pradeshiya sanwardhana|regional development bank)\\b") },
        { "HDFC", ci("^hdfc"), ci("\\bhdfc bank\\b") },
        { "LOLC", ci("^lolc"), ci("\\blolc\\b") },
        { "FriMi", ci("^frimi"), ci("\\bfrimi\\b") },
        { "eZ Cash", ci("^ezcash"), ci("\\bez ?cash\\b") },
        { "mCash", ci("^mcash"), ci("\\bmcash\\b") }
    };
    // Named senders that are never bank alerts, even when they talk about money (app.js SMS_NOT_BANKS).
    private static final Pattern NOT_BANKS = ci("^(dialog|mobitel|sltmobitel|slt$|hutch|airtel|etisalat|lankabell|ceb|leco|nwsdb|waterboard|litro|laugfs|pickme|uber|daraz"
        + "|kapruka|keells|cargills$|cargillsfood|glomark|arpico|spar|pizzahut|kfc|dominos|mcdonalds|burgerking|koko|mintpay|netflix|spotify|google|facebook|whatsapp"
        + "|instagram|tiktok|youtube|amazon|temu|aliexpress|govlk|health|police|election)");

    // ---- Never used (app.js SMS_OTP, SMS_HARD_IGNORE, SMS_SOFT_IGNORE) ----
    // A real one-time code message carries the code. "Do not share OTP" in the footer of an alert is not one.
    private static final Pattern[] OTP = {
        ci("(otp|one[ -]?time ?(pass(word|code)?|pin|code)?|verification ?code|security ?code|passcode|auth(entication)? ?code)[\\s\\S]{0,90}?(\\bis\\b|:|=)\\s*\\d{4,8}\\b(?![.,]\\d)"),
        ci("(otp|one[ -]?time password)\\s*[:\\-=]?\\s*\\d{4,8}\\b(?![.,]\\d)"),
        ci("\\b\\d{4,8}\\b\\s*(is|as) (your|the) (otp|one[ -]?time|verification|security|pin|password|code)")
    };
    private static final Pattern[] HARD_IGNORE = {
        ci("\\b(declined|was not successful|unsuccessful|not successful|failed|rejected|could not be (processed|completed)|insufficient (funds|balance))\\b"),
        ci("\\b(log(ged)?[- ]?in|sign(ed)?[- ]?in|login attempt|new device|password (was )?changed|pin (was )?changed)\\b"),
        ci("\\b(will be debited|is due on|payment due|due date|minimum (payment|due|amount)|min\\.? ?(amt|amount|payment)? ?due|e-?statement|statement (is )?(ready|generated))\\b")
    };
    // Marketing and announcements: dropped unless the text is also worded like a real, completed transaction.
    private static final Pattern[] SOFT_IGNORE = {
        ci("(\\d+ ?% ?off|\\boffer\\b|\\bdiscount\\b|\\bcashback\\b|\\bwin\\b|\\bcongratulations\\b|\\bapply now\\b|\\binstalment plan\\b|\\bpromo|\\bt&c\\b|conditions apply|\\benjoy\\b)"),
        ci("\\b(security (alert|warning)|beware of|scheduled maintenance|system maintenance|will be unavailable|temporarily unavailable)\\b")
    };
    private static final Pattern CONDITIONAL = lc("\\b(will be (credited|debited|given|added)|when you|if you|up ?to|stand a chance|valid (till|until|thru|through|from)|t&c|conditions apply|offer valid)\\b");
    private static final Pattern STRONG = lc("\\b(debited|credited|purchase (at|of)|withdrawal (at|of|from)|cash withdrawal|transaction (approved|of|alert)|txn (of|at)|auth(orised|orized)? pmt"
        + "|has been authori[sz]ed|paid to|transferred|transfer (to|from|of)|payment of|deposit(ed)? (to|of|in|at)|used (for|at)|spent|reversal|reversed|refund(ed)?|sms alert"
        + "|debit (for|of)|credit (for|of)|cefts?|slips|pos)\\b");
    // For senders Vela doesn't know: the text must be about an account or card being debited or credited.
    private static final Pattern ACCOUNT_WORDING = lc("\\b(a/c|acc?|account|acct|card|crd|savings|current)\\b[\\s\\S]{0,80}\\b(debited|credited)\\b|\\b(debited|credited)\\b[\\s\\S]{0,60}\\b(a/c|acc?|account|acct|card|crd)\\b"
        + "|\\b(credit|debit)\\s+(for|of)\\b[\\s\\S]{0,40}\\b(to|from)\\s+(a/c\\s*)?[x*\\d]{6,}"
        + "|\\b(purchase|payment|withdrawal|transaction|txn)\\b[\\s\\S]{0,160}\\b(authori[sz]ed|approved|successful)\\b[\\s\\S]{0,80}\\b(dc-card|cc-card|card|a/c|account)\\b"
        + "|\\b(purchase|payment|withdrawal|transaction|txn)\\b[\\s\\S]{0,160}\\byour\\s+(dc-card|cc-card|card|a/c|account)\\b"
        + "|\\b(purchase|payment|withdrawal|transaction|txn)\\b[\\s\\S]{0,160}\\b(dc-card|cc-card|card|a/c|account)\\s+(ending|no\\.?|number)\\b");

    // ---- Amounts (app.js smsAmounts): "LKR 1,500.00", "Rs.1,500", "USD 12.99" and (HNB) "670.59 LKR" ----
    private static final String CODES = "USD|LKR|EUR|GBP|INR|AED|SAR|QAR|KWD|OMR|AUD|CAD|SGD|MYR|JPY|CNY|MVR";
    // Lakh grouping (30,00,000.00 is three million) is tried before the usual 3-digit grouping.
    private static final String NUM = "([0-9]{1,3}(?:,[0-9]{2})+,[0-9]{3}(?:\\.[0-9]{1,2})?|[0-9]{1,3}(?:,[0-9]{3})+(?:\\.[0-9]{1,2})?|[0-9]+(?:\\.[0-9]{1,2})?)";
    private static final Pattern AMOUNT_A = ci("(" + CODES + "|SLR|Rs\\.?|US\\$)\\s*[:.]?\\s*" + NUM);
    private static final Pattern AMOUNT_B = ci(NUM + "\\s*(" + CODES + "|SLR)\\b");
    // A number is a balance or a limit (not what moved) when one of these labels sits right before it. Whole words only.
    private static final Pattern BALANCE_BEFORE = ci("\\b(?:(?:avl|av|avail|available|curr?|current|ledger|closing|a/c|acc?|account)?\\.?\\s?bal(?:ance)?|avl|avail(?:able)?(?:\\s+(?:credit|limit))?"
        + "|(?:credit\\s+|cr\\.?\\s*)?limit|outstanding|o/s|ledger)\\b[\\s.:\\-]*(?:is|of|now|amt|amount)?[\\s.:\\-]*$");

    private static final class Amount implements Comparable<Amount> {
        final String cur;
        final String text;
        final int at;
        final int end;

        Amount(String cur, String text, int at, int end) {
            this.cur = cur;
            this.text = text;
            this.at = at;
            this.end = end;
        }

        @Override public int compareTo(Amount o) { return Integer.compare(at, o.at); }
    }

    private static String currency(String written) {
        String u = written.toUpperCase(Locale.ROOT).replace(".", "");
        return u.equals("RS") || u.equals("SLR") ? "LKR" : u.equals("US$") ? "USD" : u;
    }

    /** Every amount that moved (balances and limits left out), in the order written. */
    private static List<Amount> moved(String body) {
        List<Amount> all = new ArrayList<>();
        Matcher a = AMOUNT_A.matcher(body);
        while (a.find()) {
            char before = a.start() > 0 ? body.charAt(a.start() - 1) : ' ';
            if ((before >= 'A' && before <= 'Z') || (before >= 'a' && before <= 'z')) continue; // "ORDERS 12" is not "Rs 12"
            all.add(new Amount(currency(a.group(1)), a.group(2), a.start(), a.end()));
        }
        int prefixed = all.size();
        Matcher b = AMOUNT_B.matcher(body);
        while (b.find()) {
            boolean overlaps = false;
            for (int i = 0; i < prefixed && !overlaps; i++) overlaps = b.start() < all.get(i).end && b.end() > all.get(i).at; // already read as "LKR 500.00"
            if (overlaps) continue;
            char before = b.start() > 0 ? body.charAt(b.start() - 1) : ' ';
            if ((before >= '0' && before <= '9') || before == '.' || before == ',') continue;
            all.add(new Amount(currency(b.group(2)), b.group(1), b.start(), b.end()));
        }
        Collections.sort(all);
        List<Amount> out = new ArrayList<>();
        for (Amount x : all) {
            if (!(number(x.text) > 0)) continue;
            if (has(BALANCE_BEFORE, body.substring(Math.max(0, x.at - 34), x.at))) continue;
            out.add(x);
        }
        return out;
    }

    // ---- What kind of transaction (app.js smsKindOf), on lower-case text ----
    private static final Pattern REVERSAL = lc("\\b(revers(al|ed)|reverted|void(ed)?|cancell?ed transaction|transaction cancell?ed|(ecom|pos|atm|txn|trx|pur) ?rev)\\b");
    private static final Pattern REFUND = lc("\\brefund(ed)?\\b");
    private static final Pattern CARD_PAYMENT = lc("\\bthank you for (your |the )?payment\\b|\\bpayment\\b.{0,60}\\b(to|towards|for) (your )?(cc-card|card)\\b|\\bcard (re)?payment\\b|\\bcc-card (bill )?(payment|settlement)\\b");
    private static final Pattern CREDITED = lc("\\b(credited|credit (for|of))\\b");
    private static final Pattern DEBITED = lc("\\b(debited|debit (for|of)|deducted|charged|withdrawn)\\b");
    private static final Pattern FEE = lc("\\b((service|annual|sms|alert|ledger|maintenance|card|stamp|commission|bank|atm)[ -]?(fee|fees|charge|charges)|charges? (of|debited|levied)|fee (of|debited))\\b");
    private static final Pattern INTEREST = lc("\\b(int\\.? ?pd|interest (paid|credited|credit|payment))\\b");
    private static final Pattern SALARY = lc("\\bsalary\\b");
    private static final Pattern DEPOSIT = lc("\\b(cash deposit|deposited|deposit (of|to|at|in)|cdm)\\b");
    private static final Pattern CASH_OUT = lc("\\b(cash withdrawal|cash wdl|atm (cash )?(withdrawal|wdl|w/d)|withdrawal (at|from|of)|withdrawn (at|from))\\b");
    private static final Pattern ATM = lc("\\batm\\b");
    private static final Pattern PURCHASE_WORDS = lc("\\b(pos|purchase|e-?com|internet)\\b");
    private static final Pattern TRANSFER = lc("\\b(cefts?|slips|rtgs|(fund|funds|ib|online|inward|outward|bank) ?transfer|transfer(red)?|remittance)\\b");
    private static final Pattern TRANSFER_IN = lc("\\b(inward|received|remittance|transfer(red)? from)\\b");
    private static final Pattern TO = lc("\\bto\\b");
    private static final Pattern BILL = lc("\\b(bill ?pmt|bill payment|utility payment|paid to|payment to)\\b");
    private static final Pattern ONLINE = lc("\\b(online|e-?commerce|internet|card not present|ecom|web)\\b.{0,40}\\b(purchase|payment|transaction|txn|debited|spent)\\b|\\b(purchase|payment|transaction)\\b.{0,30}\\b(online|internet)\\b"
        + "|\\bsms alert:\\s*internet\\b|\\bat\\s+[a-z0-9 .*]*\\.(com|lk|net)\\b");
    private static final Pattern CARD = lc("\\b(pos|purchase|purchased|card (was )?used|used (for|at)|spent|paid at|payment at|txn at|transaction at|transaction approved|auth(orised|orized)? pmt|has been authori[sz]ed)\\b"
        + "|\\b(payment|transaction|txn) of\\b.{0,30}\\bat\\b");

    /** "in", "out", "atm", "reversal", "cardpay", or null when the text doesn't describe a transaction. */
    static String direction(String t) {
        if (has(REVERSAL, t)) return "reversal";
        if (has(REFUND, t)) return "in";
        if (has(CARD_PAYMENT, t)) return "cardpay";
        int cr = at(CREDITED, t);
        int dr = at(DEBITED, t);
        String dir = cr >= 0 && (dr < 0 || cr < dr) ? "in" : dr >= 0 ? "out" : null;
        boolean notOut = !"out".equals(dir);
        boolean notIn = !"in".equals(dir);
        if (has(FEE, t)) return "out";
        if (notOut && (has(INTEREST, t) || has(SALARY, t) || has(DEPOSIT, t))) return "in";
        // "ATM POS Transaction" (NSB) is a card purchase; a withdrawal says so, or mentions an ATM and no purchase.
        if (notIn && (has(CASH_OUT, t) || (has(ATM, t) && !has(PURCHASE_WORDS, t)))) return "atm";
        if (has(TRANSFER, t)) {
            if ("in".equals(dir) || (dir == null && has(TRANSFER_IN, t))) return "in";
            if ("out".equals(dir) || has(TO, t)) return "out";
        }
        if (notIn && (has(BILL, t) || has(ONLINE, t) || has(CARD, t))) return "out";
        return dir;
    }

    private static final Pattern SPACES = Pattern.compile("[\\s\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF]+");
    private static final Pattern CC = lc("credit\\s*card|\\bcr\\.?\\s*crd\\b|\\bcr\\.?\\s*card\\b");
    private static final Pattern DC = lc("debit\\s*card|\\bdr\\.?\\s*crd\\b|\\bdr\\.?\\s*card\\b");
    private static final Pattern CC_LIMIT = lc("credit\\s*limit");
    private static final Pattern AVL_CC = lc("available\\s*credit");

    /** Lower case, with "credit card" / "debit card" / "credit limit" taken out of the way (app.js smsNorm). */
    static String normalise(String body) {
        String t = body.toLowerCase(Locale.ROOT);
        t = CC.matcher(t).replaceAll("cc-card");
        t = DC.matcher(t).replaceAll("dc-card");
        t = CC_LIMIT.matcher(t).replaceAll("cc-limit");
        return AVL_CC.matcher(t).replaceAll("avl-cc");
    }

    /** The bank the sender ID belongs to, else (for plain phone numbers) the bank the text names; null when neither. */
    static String bankName(String address, String body) {
        String letters = (address == null ? "" : address).replaceAll("[^A-Za-z]", "");
        for (Object[] b : BANKS) {
            if (letters.isEmpty() ? (body != null && has((Pattern) b[2], body)) : has((Pattern) b[1], letters)) return (String) b[0];
        }
        return null;
    }

    /** Null when the message isn't a bank transaction. */
    static Info parse(String address, String rawBody) {
        if (rawBody == null) return null;
        String body = SPACES.matcher(rawBody).replaceAll(" ").trim();
        if (body.isEmpty()) return null;
        for (Pattern p : OTP) if (has(p, body)) return null;
        for (Pattern p : HARD_IGNORE) if (has(p, body)) return null;
        String t = normalise(body);
        boolean soft = false;
        for (Pattern p : SOFT_IGNORE) soft = soft || has(p, body);
        if (soft && (!has(STRONG, t) || has(CONDITIONAL, t))) return null;

        String sender = address == null ? "" : address.trim();
        String letters = sender.replaceAll("[^A-Za-z]", "");
        String bank = bankName(sender, body);
        if (bank == null) {
            // A named sender that isn't on the list: only when the text is clearly about an account or card.
            if (letters.isEmpty()) {
                // A plain phone number that names no bank: kept for review only when clearly about an account.
                if (!sender.matches(".*\\d{4,}.*") || !has(ACCOUNT_WORDING, t)) return null;
                bank = "Unknown sender";
            } else {
                if (has(NOT_BANKS, letters) || !has(ACCOUNT_WORDING, t)) return null;
                bank = sender.replaceAll("[^A-Za-z0-9 +&.\\-]", "").trim();
                if (bank.length() > 24) bank = bank.substring(0, 24);
            }
        }

        List<Amount> moved = moved(body);
        if (moved.isEmpty()) return null; // no amount, or only a balance
        String dir = direction(t);
        if (dir == null) return null;
        Amount amt = moved.get(0);
        // A foreign purchase with the bank's rupee figure beside it ("USD 9.99 (LKR 3,312.45)"): the rupees are what left the account.
        if (!"LKR".equals(amt.cur)) {
            for (Amount x : moved) {
                if ("LKR".equals(x.cur) && x.at > amt.at && x.at - amt.end <= 6) { amt = x; break; }
            }
        }
        return new Info(dir, amt.text, amt.cur, bank);
    }
}
