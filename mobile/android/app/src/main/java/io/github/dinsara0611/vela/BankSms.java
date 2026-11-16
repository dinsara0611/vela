package io.github.dinsara0611.vela;

import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Recognises bank transaction SMS (Commercial Bank and other Sri Lankan banks) well enough to notify. */
final class BankSms {
    private BankSms() {}

    static final class Info {
        final String direction; // "in" or "out"
        final String amount;    // as written, e.g. "2,500.00"
        final String currency;  // "LKR" or "USD"
        final String bank;

        Info(String direction, String amount, String currency, String bank) {
            this.direction = direction;
            this.amount = amount;
            this.currency = currency;
            this.bank = bank;
        }
    }

    private static final Pattern AMOUNT = Pattern.compile("(?i)(LKR|SLR|Rs\\.?|USD|US\\$)\\s*([0-9][0-9,]*(?:\\.[0-9]{1,2})?)");
    private static final Pattern OUT = Pattern.compile("(?i)\\b(debited|debit|withdrawn|withdrawal|purchase|purchased|spent|paid|payment of|deducted|charged|transferred to|sent to)\\b");
    private static final Pattern IN = Pattern.compile("(?i)\\b(credited|deposited|deposit of|received|transferred from|salary)\\b");
    private static final Pattern SKIP = Pattern.compile("(?i)\\b(otp|one[- ]time|verification code|password|pin is|offer|win |congratulations)\\b");

    static String bankName(String address, String body) {
        String a = (address == null ? "" : address).toUpperCase(Locale.ROOT);
        String b = (body == null ? "" : body).toUpperCase(Locale.ROOT);
        if (a.contains("COMBANK") || a.contains("COMMERCIAL") || b.contains("COMMERCIAL BANK") || b.contains("COMBANK")) return "Commercial Bank";
        if (a.contains("BOC") || b.contains("BANK OF CEYLON")) return "BOC";
        if (a.contains("HNB") || b.contains("HATTON NATIONAL")) return "HNB";
        if (a.contains("SAMPATH")) return "Sampath Bank";
        if (a.contains("PEOPLES") || a.contains("PEOPLE'S") || b.contains("PEOPLE'S BANK")) return "People's Bank";
        if (a.contains("NSB")) return "NSB";
        if (a.contains("NTB") || a.contains("NATIONS")) return "Nations Trust";
        if (a.contains("SEYLAN")) return "Seylan Bank";
        if (a.contains("DFCC")) return "DFCC";
        if (a.contains("NDB")) return "NDB";
        if (a.contains("PABC") || a.contains("PAN ASIA")) return "Pan Asia Bank";
        if (a.contains("AMANA")) return "Amana Bank";
        return address == null ? "Bank" : address;
    }

    /** Null when the message isn't a bank transaction (OTPs, offers, chats...). */
    static Info parse(String address, String body) {
        if (body == null || SKIP.matcher(body).find()) return null;
        Matcher m = AMOUNT.matcher(body);
        if (!m.find()) return null;
        boolean out = OUT.matcher(body).find();
        boolean in = IN.matcher(body).find();
        if (!out && !in) return null;
        String cur = m.group(1).toUpperCase(Locale.ROOT).startsWith("US") ? "USD" : "LKR";
        return new Info(out ? "out" : "in", m.group(2), cur, bankName(address, body));
    }
}
