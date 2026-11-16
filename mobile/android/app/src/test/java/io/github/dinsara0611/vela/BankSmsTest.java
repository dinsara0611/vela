package io.github.dinsara0611.vela;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * Native filter tests. The message texts follow common Sri Lankan bank alert wording; they are examples written for
 * testing, not copies of real Commercial Bank messages, so they show the rules work, not that every real format is covered.
 */
public class BankSmsTest {
    private static final String CB = "Commercial Bank";

    @Test public void smsDebitWithBalanceTakesTheAmountNotTheBalance() {
        BankSms.Info i = BankSms.parse("COMBANK", "Dear Customer, Your A/C No.8001234567 has been debited for LKR 3,450.00 on 16/11/2026 Ref:FT2632012345. Avl Bal LKR 45,230.50");
        assertNotNull(i);
        assertEquals("out", i.direction);
        assertEquals("3,450.00", i.amount);
        assertEquals(CB, i.bank);
    }

    @Test public void smsCreditIsMoneyIn() {
        BankSms.Info i = BankSms.parse("COMBANK", "LKR 150,000.00 credited to A/C 8001234567 on 16/11/26 SALARY ABC PVT LTD. Avl Bal LKR 200,000.00");
        assertEquals("in", i.direction);
        assertEquals(150000.0, i.value(), 0.001);
    }

    @Test public void notificationDebitAndCredit() {
        BankSms.Info out = BankSms.parse(null, "Transaction Alert. LKR 3,450.00 spent at KEELLS SUPER using card ending 4321", CB);
        assertEquals("out", out.direction);
        BankSms.Info in = BankSms.parse(null, "Funds received. LKR 20,000.00 credited to your account from KAMAL SILVA", CB);
        assertEquals("in", in.direction);
    }

    @Test public void refundIsInReversalIsNotIncome() {
        assertEquals("in", BankSms.parse("COMBANK", "LKR 2,500.00 refund from DARAZ credited to your card ending 4321").direction);
        assertEquals("reversal", BankSms.parse("COMBANK", "Reversal of LKR 2,500.00 transaction at KEELLS SUPER on card ending 4321").direction);
    }

    @Test public void atmIsItsOwnKind() {
        assertEquals("atm", BankSms.parse("COMBANK", "ATM Cash Withdrawal LKR 10,000.00 from A/C ...1234 at COMBANK ATM KOLLUPITIYA").direction);
    }

    @Test public void neverKeepsCodesFailuresAlertsOrPromotions() {
        String[] ignored = {
            "Your OTP for the transaction of LKR 3,450.00 at DARAZ is 123456. Do not share. ComBank",
            "Your transaction of LKR 5,000.00 at ABC STORE was declined due to insufficient funds. ComBank",
            "ComBank: Fund transfer of LKR 10,000.00 failed. Please try again.",
            "Your A/C ...1234 Avl Bal is LKR 45,230.50 as at 16/11/2026. ComBank",
            "You have logged in to ComBank Digital on 16/11/2026 10:00.",
            "Enjoy 20% off at ODEL with ComBank cards. Spend LKR 10,000 and win! ComBank",
            "ComBank: Your credit card payment of LKR 15,000.00 is due on 25/11/2026.",
            "ComBank security alert: beware of calls asking for your PIN. Never share LKR 0.00",
            "ComBank Digital will be unavailable on 20/11 due to scheduled maintenance."
        };
        for (String s : ignored) assertNull(s, BankSms.parse("COMBANK", s));
    }

    @Test public void notABankIsDropped() {
        assertNull(BankSms.parse("0771234567", "Hi machan, send me Rs. 500 for the bus"));
    }

    @Test public void hiddenNotificationContentIsRecognised() {
        assertTrue(BankSms.looksHidden("Contents hidden"));
        assertTrue(BankSms.looksHidden(""));
        assertTrue(BankSms.looksHidden("You have a new notification"));
        assertFalse(BankSms.looksHidden("LKR 3,450.00 spent at KEELLS"));
    }

    @Test public void smsAndNotificationForOnePurchaseAreLikelyTheSame() {
        BankSms.Info sms = BankSms.parse("COMBANK", "LKR 3,450.00 POS purchase at KEELLS SUPER on card ending 4321");
        BankSms.Info ntf = BankSms.parse(null, "Transaction Alert. LKR 3,450.00 spent at KEELLS SUPER", CB);
        long t = 1_700_000_000_000L;
        assertTrue(BankSms.likelySame(sms, "sms", t, ntf, "notification", t + 40_000, SmsStore.SAME_WINDOW_MS));
    }

    @Test public void twoSmsWithTheSameAmountAreTwoPurchases() {
        BankSms.Info a = BankSms.parse("COMBANK", "LKR 500.00 POS purchase at CARGILLS on card ending 4321");
        BankSms.Info b = BankSms.parse("COMBANK", "LKR 500.00 POS purchase at CARGILLS on card ending 4321");
        long t = 1_700_000_000_000L;
        assertFalse(BankSms.likelySame(a, "sms", t, b, "sms", t + 60_000, SmsStore.SAME_WINDOW_MS));
    }

    @Test public void farApartOrDifferentAmountsAreDifferent() {
        BankSms.Info sms = BankSms.parse("COMBANK", "LKR 3,450.00 POS purchase at KEELLS SUPER");
        BankSms.Info other = BankSms.parse(null, "LKR 3,450.00 spent at KEELLS SUPER", CB);
        BankSms.Info diff = BankSms.parse(null, "LKR 3,451.00 spent at KEELLS SUPER", CB);
        long t = 1_700_000_000_000L;
        assertFalse(BankSms.likelySame(sms, "sms", t, other, "notification", t + 3 * 60 * 60 * 1000L, SmsStore.SAME_WINDOW_MS));
        assertFalse(BankSms.likelySame(sms, "sms", t, diff, "notification", t, SmsStore.SAME_WINDOW_MS));
    }

    @Test public void onlyVerifiedCommercialBankAppsAreListenedTo() {
        assertTrue(BankSms.isBankApp("combank.com.combankdigital"));
        assertFalse(BankSms.isBankApp("com.whatsapp"));
        assertFalse(BankSms.isBankApp(null));
    }
}
