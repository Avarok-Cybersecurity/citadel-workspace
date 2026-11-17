# Citadel Workspace Privacy Notice

**Effective October 23, 2026**

This Privacy Notice explains how **Avarok Corp**, a Delaware corporation ("Avarok", "we", "us"), collects, uses, and shares personal information in connection with Citadel Workspace, including the web application, the Citadel Agent software, hosted workspace servers, and our websites (the "Service").

## 1. Our role

- **Workspace data.** Each workspace is created and administered by a customer (the "Workspace Owner"). For personal information stored in a workspace, such as membership, roles, profiles, shared content, and diagnostic logs, the Workspace Owner is the controller and Avarok acts as its processor or service provider. If you have questions about how a workspace uses your information, contact its Workspace Owner or Admins. We handle that information under our agreement with the Workspace Owner, including our Data Processing Addendum.
- **Our own data.** Avarok is the controller of the information we process for our own purposes: workspace creation and billing, the security and operation of the Service, our websites, and communications with you.

## 2. Information we collect

**Account information.** Your username and the name you choose to display, and any profile details you add, such as an email address, job title, or avatar.

**Credentials.** Sign-in uses post-quantum cryptographic protocols designed so that your password is not sent to or stored by our servers in readable form. If you use a passkey, your device holds the private key and we store only what is needed to verify it.

**Content.** Messages and files exchanged directly between members' agents, including through relays we operate, are **encrypted end to end, and we cannot read them**. Content you post to shared workspace channels or storage is stored on the workspace server on the Workspace Owner's behalf.

**Diagnostic logs (optional).** Only if you turn diagnostic logs on, your Citadel Agent sends warning and error log lines about your use of that workspace, plus the agent version and operating system. These include the warnings and errors the Citadel web app writes to your browser's console, which the web app passes to your Citadel Agent; lines raised by browser extensions are left out. Before sending, the agent removes usernames, names, file names and paths, network addresses, host names, and secrets from every line. Numeric peer identifiers are kept so connection problems can be diagnosed. Message content, file content, and encryption keys are never deliberately included, although an error message can occasionally quote text the app was handling when the error occurred. Diagnostic logs also include connection reports: the kind of connection used between you and another member (direct or relayed), how long each step took, why a step failed, and each side's type of network address translation, with no network addresses.

**Connection information.** Whether or not diagnostic logs are on, the workspace server learns which members connect to each other, when, how much data passes, and which kind of connection is used, including for requests that apps you allowed exchange directly with other members' copies of the same app (not their content). We use this to route and meter connections.

**Workspace creation and billing.** When you create a workspace, we collect the workspace name and address you choose, your plan, and the contact email you provide. Payments are handled by our payment processor, Stripe. We receive your billing contact details and the status of your subscription and payments, **not your full card number**.

**Technical and security information.** When you use the Service, our infrastructure provider processes network information such as IP addresses, connection metadata, and request logs, to route traffic, relay connections, prevent abuse, and keep the Service secure. We use a bot-protection check (Cloudflare Turnstile) during some sign-ups and sign-ins. We also record service metrics, such as usage against plan quotas, for operation and billing.

**On your device.** The web application and the Citadel Agent store data locally on your device, such as session state, cached messages, and settings, to make the Service work. We do not use advertising cookies or sell your information.

**Communications.** If you contact us, we keep the messages and the contact details you give us.

## 3. How we use information

We use personal information to:

1. provide, maintain, and secure the Service, including relaying connections and preventing fraud and abuse;
2. create workspaces, manage subscriptions, process payments, and enforce plan limits;
3. provide support, including reading diagnostic logs **only when a workspace Admin has granted us support access**;
4. send service-related notices, such as security notices, changes to our terms, and billing notices;
5. comply with law and enforce our terms; and
6. improve the Service using aggregated metrics that do not include the content of your communications.

Where the law of your country requires a legal basis, we rely on: performance of our contract with you or the Workspace Owner; our legitimate interests in operating, securing, and improving the Service; compliance with legal obligations; and your consent, for optional diagnostic logs, which you can withdraw at any time in Settings → Privacy.

## 4. How we share information

We do not sell or rent personal information, and we do not share it for cross-context behavioral advertising. We share it only:

- **with the Workspace Owner and its Admins**, for the workspace you belong to, according to the permissions they set;
- **with our subprocessors**, who process data on our behalf under contracts that protect it, listed at https://work.avarok.net/legal/subprocessors;
- **for legal reasons**, when required by law or legal process, or when necessary to protect the rights, property, or safety of our users, Avarok, or others. We cannot disclose end-to-end encrypted content we cannot access;
- **in a business transfer**, such as a merger, acquisition, or sale of assets, subject to this Notice; and
- **with your direction or consent**.

## 5. Retention

- Workspace data is kept for as long as the Workspace Owner keeps the workspace. After a workspace is terminated, it is kept for up to 30 days so the Workspace Owner can export it, and then deleted, unless the law requires us to keep it longer.
- Diagnostic logs are kept for the retention period the workspace's Admins set, up to 90 days, and are deleted when you turn diagnostic logs off.
- Billing records are kept as long as tax and accounting law requires.
- Security and request logs are kept for limited periods needed for security and troubleshooting.

## 6. Security

We protect information with measures including end-to-end and post-quantum encryption, encrypted connections, isolation of each workspace's server, access controls, audit logging of support access, and cryptographically signed software updates. No system is perfectly secure. If we become aware of a security breach affecting your personal information, we will notify you or the Workspace Owner as required by law.

## 7. International transfers

Avarok is based in the United States, and our subprocessors operate globally. Your information may be processed in the United States and other countries. Where required, we use appropriate safeguards for international transfers, such as the European Commission's Standard Contractual Clauses, including through our Data Processing Addendum.

## 8. Your rights and choices

Depending on where you live, you may have the right to access, correct, delete, or receive a copy of your personal information, to restrict or object to certain processing, and to withdraw consent. You may also have the right not to be discriminated against for exercising these rights. Residents of California, other U.S. states, the European Economic Area, the United Kingdom, and Switzerland have rights under their local laws.

- **In the app:** edit your profile, turn diagnostic logs on or off, and delete your stored diagnostic logs in Settings → Privacy.
- **Workspace data:** because the Workspace Owner controls it, we may refer your request to the Workspace Owner and help them respond.
- **Our own data:** email security@avarok.net. We will verify your request and respond within the time the law requires. You may use an authorized agent where the law allows.
- **Complaints:** you may also complain to your local data protection authority.

## 9. Children

The Service is not directed to children under 16, and we do not knowingly collect personal information from them. If you believe a child has provided us personal information, contact us and we will delete it.

## 10. Changes

We may update this Notice. If we make material changes, we will update the effective date and notify you through the Service or by email where appropriate.

## 11. Contact

Avarok Corp, 251 Little Falls Drive, Wilmington, DE 19808, United States · security@avarok.net
