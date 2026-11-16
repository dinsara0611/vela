package io.github.dinsara0611.vela;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;

import org.junit.Test;

/**
 * Native SMS filter tests. The message texts follow common Sri Lankan bank alert wording with numbers and names
 * made up; they are not copies of real Commercial Bank messages, so they show the rules work, not that every real
 * format is covered. The app (app.js) does the full reading; this filter decides what is kept and notified.
 */
public class BankSmsTest {
    private static final String CB = "Commercial Bank";

    @Test public void debitWithBalanceTakesTheAmountNotTheBalance() {
        BankSms.Info i = BankSms.parse("COMBANK", "Dear Customer, Your A/C No.8001234567 has been debited for LKR 3,450.00 on 16/11/2026 Ref:FT2632012345. Avl Bal LKR 45,230.50");
        assertNotNull(i);
        assertEquals("out", i.direction);
        assertEquals("3,450.00", i.amount);
        assertEquals(CB, i.bank);
    }

    @Test public void creditIsMoneyIn() {
        BankSms.Info i = BankSms.parse("COMBANK", "LKR 150,000.00 credited to A/C 8001234567 on 16/11/26 SALARY ABC PVT LTD. Avl Bal LKR 200,000.00");
        assertEquals("in", i.direction);
        assertEquals(150000.0, i.value(), 0.001);
    }

    @Test public void cardAndOnlinePaymentsAreOut() {
        assertEquals("out", BankSms.parse("COMBANK", "LKR 3,450.00 POS purchase at KEELLS SUPER on card ending 4321 on 16/11/2026").direction);
        BankSms.Info usd = BankSms.parse("COMBANK", "Your ComBank Card ending 4321 was used for an online transaction of USD 12.99 at NETFLIX.COM");
        assertEquals("out", usd.direction);
        assertEquals("USD", usd.currency);
    }

    @Test public void transfersGoTheRightWay() {
        assertEquals("out", BankSms.parse("COMBANK", "CEFT transfer of LKR 25,000.00 to NIMAL PERERA from A/C ...1234 successful on 16/11/2026").direction);
        assertEquals("in", BankSms.parse("COMBANK", "Fund transfer LKR 20,000.00 received from KAMAL SILVA via CEFT to A/C ...1234").direction);
    }

    @Test public void refundIsInReversalIsNotIncome() {
        assertEquals("in", BankSms.parse("COMBANK", "LKR 2,500.00 refund from DARAZ credited to your card ending 4321").direction);
        assertEquals("reversal", BankSms.parse("COMBANK", "Reversal of LKR 2,500.00 transaction at KEELLS SUPER on card ending 4321").direction);
    }

    @Test public void atmIsItsOwnKind() {
        assertEquals("atm", BankSms.parse("COMBANK", "ATM Cash Withdrawal LKR 10,000.00 from A/C ...1234 at COMBANK ATM KOLLUPITIYA").direction);
    }

    @Test public void bankChargeIsOut() {
        assertEquals("out", BankSms.parse("COMBANK", "Service charge of LKR 150.00 debited from A/C ...1234 for SMS alerts").direction);
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

    @Test public void bankNamedInTheTextIsEnoughWhenTheSenderIsANumber() {
        BankSms.Info i = BankSms.parse("+94112353353", "ComBank: LKR 1,200.00 debited from your A/C ...1234 at CARGILLS");
        assertNotNull(i);
        assertEquals(CB, i.bank);
    }
}
