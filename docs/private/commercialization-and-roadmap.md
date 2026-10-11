# Commercialization, Legal Considerations & Product Roadmap

## 1. Legal, Licensing & Author Stance

### 1.1 Firefly III Author's Stance (James Cole / JC5)
* **No Opposition to Third-Party Frontends or Monetization:** James Cole has never taken issue with developers building frontends or charging for them. In fact, Firefly III maintains an official documentation page explicitly listing third-party mobile clients (such as Waterfly III, Abacus, Photuris III, and FireFlow on iOS).
* **Precedents:** Ecosystem apps like *FireFlow for Firefly III* (iOS) offer in-app purchases. Furthermore, the official Firefly III Data Importer integrates with commercial data providers (like SimpleFIN and Lunch Flow) that charge recurring subscription fees; the official documentation acknowledges that these tools charge money.
* **James Cole's Operating Model:** James Cole develops Firefly III as a hobby/passion project and works a separate full-time job. He has repeatedly noted in GitHub discussions that he does not want to build mobile apps or a cloud SaaS due to maintenance burden and lifestyle preferences. He encourages the community to build mobile apps on top of the public REST API.

### 1.2 Legal & Licensing Reality (AGPLv3)
* **Firefly III Backend License:** Firefly III is licensed under GNU Affero General Public License v3 (AGPLv3).
* **API Interaction Over Network:** Under copyright law and Free Software Foundation guidance, independent software that communicates with an AGPL server strictly across network protocols (HTTP REST API) is not a derivative work. The copyleft provisions of AGPLv3 do not "infect" or extend to client applications running on user devices.
* **mmyway Codebase Ownership:** The code for `mmyway` was written independently and licensed under the PolyForm Noncommercial License with copyright held solely by the author (Mykola Odnosumov). All dependencies in `package.json` are standard permissive licenses (MIT, Apache-2.0, BSD). Therefore, the author has complete legal freedom to:
  1. Remove the code from public GitHub or make the repository private.
  2. Relicense the app under a closed-source proprietary commercial license / EULA.
  3. Distribute the application on the Google Play Store / App Store for a fixed upfront price.

### 1.3 Key Brand & Community Guidelines
1. **Name and Logo Policy:** Firefly III has an explicit name and logo policy. The app must not be named "Firefly III" (or imply it is the official app). A distinct name must be used (e.g., "mmyway: for Firefly III"). The official logo (the flame piggy) must not be used as the app icon or marketing brand. A clear disclaimer must be included: *"mmyway is an independent client and is not affiliated with, endorsed by, or sponsored by Firefly III or James Cole."*
2. **Support Burden:** Avoid directing users to Firefly III's GitHub issues for app bugs. Maintain independent support and in-app diagnostics.

---

## 2. Critical Paths Missing for a Commercial Standalone Client

For users paying a fixed upfront price for a primary mobile driver for Firefly III, the following gaps must be resolved:

### 2.1 Account Creation & Full Management
* **Current State:** Asset accounts can only be reordered and edited (opening balance, envelope status, role, active status). Users cannot create accounts.
* **Required Flow:**
  - `POST /v1/accounts`: Creation modal for Asset, Liability (Credit Card, Loan, Debt), Cash, and Revenue/Expense accounts.
  - Liability support: Interest rate, payment frequency, credit limit.
  - Archiving / Deactivating accounts.

### 2.2 Rules & Automation Management
* **Current State:** Rules are only touched as part of the rigid subscription trio (`bill + rule + recurrence`) in `src/planned/`. Standalone automation rules are read-only or absent.
* **Required Flow:**
  - View and toggle Rule Groups (`/v1/rule-groups`) and Rules (`/v1/rules`).
  - "Create Rule from Transaction" quick action on the Transaction screen (e.g., auto-set Category and Budget whenever payee matches).
  - Ability to trigger rules on existing transactions.

### 2.3 Piggy Banks (Savings Goals)
* **Current State:** No support in `mmyway`.
* **Required Flow:**
  - Piggy Banks (`/v1/piggy-banks`) are a core consumer feature of FF3.
  - View goals, target amounts, target dates, and saved balances.
  - Add/remove money to/from piggy banks (`/v1/piggy-banks/{id}/events`).

### 2.4 Financial Overview & Reporting (Dashboard)
* **Current State:** The Activity tab lists account balances and chronological transactions. There are no aggregate charts or summaries.
* **Required Flow:**
  - Monthly Cash Flow: Income vs. Expenses summary.
  - Category Spending Breakdown: Progress bars or pie charts for current period.
  - Net Worth Trend: Historical net worth trajectory using FF3 endpoints.

### 2.5 Android Notification & SMS Auto-Capture
* **Opportunity:** High-value differentiator on Android (popularized by Waterfly III and Cashew).
* **Architecture:** `mmyway`'s `capture → inbox → confirm → sync` pipeline is uniquely suited for a Notification Listener service. When a bank notification arrives, a background service parses amount and payee, depositing a draft directly into `inbox_items` in the `parsed` state for user confirmation.

### 2.6 Biometric App Lock
* **Current State:** No app-level security.
* **Requirement:** Biometric authentication (Fingerprint / Face Unlock / PIN via `expo-local-authentication`) on app launch and resume after timeout.

### 2.7 Homelab Network & SSL Realities
* **Self-Signed TLS:** Many self-hosters run internal HTTPS with self-signed certificates or local CAs. React Native's default `fetch` rejects these. A setting to trust custom certificates or allow insecure TLS for local development/homelab networks is critical.
* **Reverse Proxy Headers:** Support for Cloudflare Access (`CF-Access-Client-Id` and `CF-Access-Client-Secret`) and HTTP Basic Auth headers in `src/api/ff3/client.ts`.

### 2.8 Google Play Review Requirements
* Google Play reviewers require functioning credentials to test and approve the app during review. A self-hosted app must provide either:
  1. A public demo Firefly III instance with test credentials in Play Console review notes.
  2. A local "Demo / Sandbox Mode" built into the app.

### 2.9 AI Receipt Business Model
* **Fixed Price Model:** For a fixed one-time app purchase, hosting a central LLM proxy will result in recurring API costs exceeding revenue.
* **BYOK (Bring Your Own Key):** Retain the existing model: users provide their own Google Gemini API key (generous free tier) or point to a self-hosted local model (Ollama / vLLM).
