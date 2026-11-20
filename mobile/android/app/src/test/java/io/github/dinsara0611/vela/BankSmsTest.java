package io.github.dinsara0611.vela;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;
import org.junit.Test;

/**
 * Native SMS filter tests. The messages are in tests/sms-corpus.tsv at the top of the project, which the app's own
 * tests (tests/feature-check.js) read too: both readers have to agree on every line. The message shapes follow real
 * Sri Lankan bank alerts; every name, number and amount in them is made up.
 */
public class BankSmsTest {
    private static final String CB = "Commercial Bank";

    private static File corpus() {
        File dir = new File("").getAbsoluteFile();
        for (int up = 0; up < 6 && dir != null; up++, dir = dir.getParentFile()) {
            File f = new File(dir, "tests/sms-corpus.tsv");
            if (f.isFile()) return f;
        }
        throw new AssertionError("tests/sms-corpus.tsv not found above " + new File("").getAbsolutePath());
    }

    @Test public void everySampleMessageIsReadLikeTheAppReadsIt() throws Exception {
        List<String> wrong = new ArrayList<>();
        int checked = 0;
        for (String line : Files.readAllLines(corpus().toPath(), StandardCharsets.UTF_8)) {
            if (line.isEmpty() || line.startsWith("#")) continue;
            String[] f = line.split("\t", 3);
            assertEquals("three tab-separated fields: " + line, 3, f.length);
            String body = f[2].replace("\\n", "\n");
            BankSms.Info got = BankSms.parse(f[1], body);
            checked++;
            if (f[0].equals("none")) {
                if (got != null) wrong.add("should be ignored, read as " + got.direction + " " + got.amount + ": " + f[2]);
                continue;
            }
            String[] want = f[0].split(" ", 4); // direction currency amount bank
            if (got == null) { wrong.add("not read (want " + f[0] + "): " + f[2]); continue; }
            String is = got.direction + " " + got.currency + " " + got.value() + " " + got.bank;
            boolean same = got.direction.equals(want[0]) && got.currency.equals(want[1])
                && Math.abs(got.value() - Double.parseDouble(want[2])) < 0.005 && got.bank.equals(want[3]);
            if (!same) wrong.add("want " + f[0] + ", got " + is + ": " + f[2]);
        }
        assertTrue("the sample list is there", checked >= 60);
        assertTrue(wrong.size() + " of " + checked + " read differently:\n" + String.join("\n", wrong), wrong.isEmpty());
    }

    @Test public void theAmountIsKeptAsWritten() {
        BankSms.Info i = BankSms.parse("COMBANK", "Dear Customer, Your A/C No.8001234567 has been debited for LKR 3,450.00 on 16/11/2026 Ref:FT2632012345. Avl Bal LKR 45,230.50");
        assertNotNull(i);
        assertEquals("out", i.direction);
        assertEquals("3,450.00", i.amount);
        assertEquals(3450.0, i.value(), 0.001);
        assertEquals(CB, i.bank);
    }

    @Test public void aShopNameWithBalInItIsNotABalance() {
        BankSms.Info i = BankSms.parse("COMBANK", "Dear Cardholder, Purchase at HERBAL CARE LK for LKR 950.00 on 16/11/26 09:10 AM has been authorised on your debit card ending #5370.");
        assertNotNull(i);
        assertEquals(950.0, i.value(), 0.001);
    }

    @Test public void aMessageWithOnlyABalanceIsNotATransaction() {
        assertNull(BankSms.parse("HNB", "HNB SMS ALERT: Av.Bal:14621.99 LKR as at 16.11.26"));
        assertNull(BankSms.parse("COMBANK", "Your A/C ...1234 Avl Bal is LKR 45,230.50 as at 16/11/2026. ComBank"));
    }

    @Test public void aFooterThatMentionsOtpDoesNotHideTheTransaction() {
        BankSms.Info i = BankSms.parse("SAMPATHTXN", "LKR 4,025.00 debited from AC **8758 for PICKME - 37419306\n16/11/2026 11:36:52\nTo Inq Call 0112303050\nGet protected -Do not Share OTP");
        assertNotNull(i);
        assertEquals("out", i.direction);
        assertEquals("Sampath Bank", i.bank);
        assertNull(BankSms.parse("SAMPATHTXN", "Your OTP is 482913. Do not share it with anyone."));
    }

    @Test public void payingYourOwnCardIsNeitherIncomeNorSpending() {
        assertEquals("cardpay", BankSms.parse("NTB", "Thank you for your payment of LKR 57,018.67 made to Card # 123456*****1234 on 16-11-2026.").direction);
        assertEquals("cardpay", BankSms.parse("HNB", "LKR 10,000.00 debited to Ac No:20802XXXXX39 on 16/11/26 10:18:43 Reason:CARD PAYMENT Bal:LKR 5,000.00").direction);
    }

    @Test public void aCreditCardPurchaseIsNotACredit() {
        BankSms.Info i = BankSms.parse("SAMPCCTXN", "Cr Crd no..**0282 Auth Pmt LKR 2,100.00 at SPICE ASIA - DELIVERY Avl Bal LKR 250,000.00 Enq Call 0112300604");
        assertNotNull(i);
        assertEquals("out", i.direction);
        assertEquals(2100.0, i.value(), 0.001);
    }

    @Test public void aRupeeFigureBesideAForeignAmountIsTheAmount() {
        BankSms.Info i = BankSms.parse("COMBANK", "Purchase at NETFLIX.COM for USD 9.99 (LKR 3,312.45) on 16/11/26 from card ending #5370. Avl Bal LKR 80,000.00");
        assertEquals("LKR", i.currency);
        assertEquals(3312.45, i.value(), 0.001);
        BankSms.Info usd = BankSms.parse("COMBANK", "Your ComBank Card ending 4321 was used for an online transaction of USD 12.99 at NETFLIX.COM");
        assertEquals("USD", usd.currency);
    }

    @Test public void unknownSendersNeedAccountWordingAndShopsNeverCount() {
        BankSms.Info i = BankSms.parse("XYZ Finance", "Your account 1234 has been debited with Rs. 2,000.00 at CITY PHARMACY on 16/11/2026");
        assertNotNull(i);
        assertEquals("XYZ Finance", i.bank);
        assertNull(BankSms.parse("Daraz", "Your payment of Rs. 2,500 using ComBank card ending 1234 was successful. Thank you for shopping with us"));
        assertNull(BankSms.parse("Dialog", "Your account has been debited with Rs. 100.00 for the data pack you activated"));
        assertNull(BankSms.parse("0771234567", "Hi machan, send me Rs. 500 for the bus"));
        assertNull(BankSms.parse(null, null));
        assertNull(BankSms.parse("COMBANK", "   "));
    }

    @Test public void aBankNamedInTheTextIsEnoughWhenTheSenderIsANumber() {
        BankSms.Info i = BankSms.parse("+94112353353", "ComBank: LKR 1,200.00 debited from your A/C ...1234 at CARGILLS");
        assertNotNull(i);
        assertEquals(CB, i.bank);
    }

    @Test
    public void bankAppsAreFoundByPackageNameAndNothingElse() {
        assertEquals(CB, BankSms.bankForApp("net.combank.passbook"));
        assertEquals(CB, BankSms.bankForApp("combank.com.combankdigital"));
        assertEquals(CB, BankSms.bankForApp("com.euronetindia.combankqpluscustomer"));
        assertEquals("BOC", BankSms.bankForApp("com.boc.itdiv.smartpassbook"));
        assertEquals("Sampath Bank", BankSms.bankForApp("lk.sampath.vishwa.retail"));
        assertNull(BankSms.bankForApp("com.whatsapp"));
        assertNull(BankSms.bankForApp("com.paypal.android.p2pmobile"));
        assertNull(BankSms.bankForApp("io.github.dinsara0611.vela"));
    }

    @Test
    public void passbookNotificationsUseTheAppsBankAndSameRules() {
        BankSms.Info i = BankSms.parse(null, "Transaction Alert. LKR 1,560.00 debited from your A/C 8001XXXX559 for CEB bill payment.", CB);
        assertNotNull(i);
        assertEquals(CB, i.bank);
        assertEquals("out", i.direction);
        assertNull(BankSms.parse(null, "Your OTP is 482913. Do not share it.", CB));
        assertTrue(BankSms.looksHidden("Contents hidden"));
        BankSms.Info sms = BankSms.parse("COMBANK", "LKR 1,560.00 debited from A/C ...559 for CEB bill payment");
        assertTrue(BankSms.likelySame(i, "notification", 1000L, sms, "sms", 60000L, 15 * 60 * 1000L));
        assertTrue(!BankSms.likelySame(i, "sms", 1000L, sms, "sms", 60000L, 15 * 60 * 1000L));
    }
}
