# Google Play Submission Copy & Metadata — mmyway

---

## 1. Store Listing

### **App Name**
mmyway

### **Short Description** (80 characters max)
Fast expense capture and receipt scanning for your own Firefly III server.

### **Category**
- **Primary:** Finance

### **Tags / Keywords**
firefly iii,expense tracker,receipt scanner,budget,self-hosted,personal finance,offline

---

## 2. Full Description

**Capture Every Expense in Seconds, Straight Into Your Own Firefly III**

*mmyway* is a quick-capture companion for Firefly III, the self-hosted personal finance
manager. Type an amount, pick a payee, done. Or snap a receipt and let the app draft the
entry for you.

Nothing reaches your server until you approve it: every entry lands in an Inbox first, so
you stay in control of your books.

---

### **Why You'll Love "mmyway"**

- ⌨️ **Amount-First Capture:** A big keypad and one-tap chips for payee, account and category, learned from your own history.
- 🧾 **Receipt Scanning:** Photograph or share a receipt; a local model or your own Gemini key turns it into a draft.
- ✅ **Inbox That Approves:** Review drafts, fix what's off, and confirm. Nothing syncs without your sign-off.
- 📶 **Works Offline:** Entries queue on the phone and sync to Firefly III once you're back online.
- 🔒 **Your Server, Your Data:** No account with us, no cloud of ours, no tracking.

---

### **Key Features**

- **Aliases:** Teach the app that "zabka" means your usual grocery payee.
- **Multiple Server Addresses:** Reach Firefly III at home over the LAN and away over your VPN.
- **Activity & Recurring Reviews:** Browse and edit synced transactions, attach receipts, and review recurring ones in the Inbox.
- **Complete Privacy:** No analytics SDKs, no ads, no third-party tracking.

Spend less time logging and more time knowing where your money goes. Get *mmyway* today!

---

## 3. Play Console Information

### **Website**
`https://mkloouo.com`

### **Email**
`feedback@mkloouo.com`

### **Privacy Policy URL**
`https://mkloouo.com/mmyway/privacy` *(link to hosted privacy policy file)*

---

## 4. Data Safety (Play Console)

When completing the **Data safety** form:

- **Data collection:** No data is collected by the developer.
- **Data sharing:** Photos are shared with Google (Gemini API) **only** if the user adds
  their own Gemini API key and scans a receipt; declare "Photos" as shared, optional,
  for app functionality.
- **Encryption in transit:** Yes, when the user's Firefly III address uses HTTPS.
- **Explanation:** Financial entries are sent only to the Firefly III server the user
  configures. The app has no backend of its own.

---

## 5. Permissions

- `android.permission.CAMERA` — to photograph receipts.
- Share target for `image/*` — to receive receipt images shared from other apps.

---

## 6. Reviewer Notes (App Access)

> *mmyway* is a client for a self-hosted Firefly III server.
>
> - **Account Credentials:** The app needs a Firefly III address and a personal access
>   token. Provide a demo instance and token here before submitting.
> - **Backend / Servers:** The app talks only to the configured Firefly III server and,
>   optionally, to a receipt model the user configures.
> - **Testing steps:**
>   1. In Settings, add the Firefly III address and access token.
>   2. Tap **＋ Add** and type an amount, pick a payee, and save.
>   3. Open the Inbox and confirm the entry; it syncs to Firefly III.
>   4. Tap the camera button to photograph a receipt and review the draft.
