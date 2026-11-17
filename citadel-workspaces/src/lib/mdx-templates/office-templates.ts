/**
 * Office MDX Templates
 *
 * Pre-defined MDX content templates for office types.
 */

import { TemplateCategory, TemplateTheme, type MdxTemplate } from './types';

export const generalOfficeTemplate: MdxTemplate = {
  id: 'office-general',
  name: 'General Office',
  description: 'A standard office space for general team collaboration',
  category: TemplateCategory.TOP_LEVEL,
  type: TemplateTheme.GENERAL,
  content: `# Welcome to the General Office

<Card title="About this space" description="Replace this with a one-line summary of what this office is for">

_Describe who works here, what the office is used for, and what people should expect to find on this page._

</Card>

## Announcements

> _Post the most important current announcement here. Replace or remove it once it is no longer relevant._

- _Date — short announcement_
- _Date — short announcement_

## Team

| Name | Role | Best way to reach |
| ---- | ---- | ----------------- |
| _Add a name_ | _Role_ | _Room, direct message, hours_ |
| _Add a name_ | _Role_ | _Room, direct message, hours_ |

## Quick links

- _Add a link to your team calendar_
- _Add a link to your shared documents_
- _Add a link to the company handbook_

## Getting started checklist

- [ ] Introduce yourself in the team chat room
- [ ] Read the pinned announcements
- [ ] _Add an onboarding step for your team_

## How to ask for help

_Explain where questions should go, who to contact for what, and the response time people can expect._
`
};

export const engineeringOfficeTemplate: MdxTemplate = {
  id: 'office-engineering',
  name: 'Engineering Office',
  description: 'A workspace tailored for engineering teams with technical resources',
  category: TemplateCategory.TOP_LEVEL,
  type: TemplateTheme.ENGINEERING,
  content: `# Welcome to the Engineering Office

<Card title="Team overview" description="What this team owns and how it works">

_Describe the systems, services or products this team is responsible for, and link to the main repositories._

</Card>

## Current sprint

**Sprint goal:** _State the one outcome this sprint is aiming for._

| Item | Owner | Status |
| ---- | ----- | ------ |
| _Short description of the work_ | _Name_ | <Badge variant="secondary">To do</Badge> |
| _Short description of the work_ | _Name_ | <Badge>In Progress</Badge> |
| _Short description of the work_ | _Name_ | <Badge variant="outline">Done</Badge> |

## On-call rota

| Week of | Primary | Secondary |
| ------- | ------- | --------- |
| _Date_ | _Name_ | _Name_ |
| _Date_ | _Name_ | _Name_ |

<Alert title="Paging">
_Explain how to reach the on-call engineer and what counts as an urgent issue._
</Alert>

## Key links

- _Source repositories_
- _CI/CD pipelines_
- _Issue tracker_
- _Architecture and design documents_

## Runbooks

### _Runbook name, e.g. restarting a service_

1. _First step_
2. _Second step_
3. _How to confirm it worked_

## Working agreements

- [ ] _Code review expectations, e.g. one approval before merge_
- [ ] _Definition of done_
- [ ] _Release process_

## How to ask for help

_Say which room to post questions in, what details to include (error text, steps to reproduce), and who to escalate to._
`
};

export const designOfficeTemplate: MdxTemplate = {
  id: 'office-design',
  name: 'Design Office',
  description: 'A creative space for design teams with visual resources',
  category: TemplateCategory.TOP_LEVEL,
  type: TemplateTheme.DESIGN,
  content: `# Welcome to the Design Studio

<Card title="About the design team" description="What we design and how to work with us">

_Describe the products, brands or surfaces this team designs for, and how other teams should bring work to you._

</Card>

## Design system

- _Link to the component library_
- _Link to colour, typography and spacing guidelines_
- _Link to accessibility guidelines_

## Current projects

| Project | Designer | Stage |
| ------- | -------- | ----- |
| _Project name_ | _Name_ | <Badge variant="secondary">Research</Badge> |
| _Project name_ | _Name_ | <Badge>In Progress</Badge> |
| _Project name_ | _Name_ | <Badge variant="outline">Handed off</Badge> |

## Brand assets

- _Where to find logos and approved variations_
- _Where to find photography and illustration_
- _Templates for slides and documents_

## Team

| Name | Focus | Contact |
| ---- | ----- | ------- |
| _Add a name_ | _e.g. product design, brand, research_ | _How to reach them_ |

## Requesting design work

1. _Describe the problem, not the solution_
2. _Include the audience, deadline and any constraints_
3. _Post the request in the design room_

## Design review checklist

- [ ] Meets accessibility contrast and sizing guidelines
- [ ] Uses design system components where they exist
- [ ] _Add a check your team always makes_

## Inspiration

_Collect references, articles and examples the team finds useful._
`
};

export const securityOfficeTemplate: MdxTemplate = {
  id: 'office-security',
  name: 'Security Office',
  description: 'A workspace for cybersecurity professionals',
  category: TemplateCategory.TOP_LEVEL,
  type: TemplateTheme.SECURITY,
  content: `# Security Office

<Card title="About the security team" description="What we protect and how to reach us">

_Describe the scope of this team: which systems, data and processes it is responsible for._

</Card>

<Alert title="Reporting a security issue" variant="destructive">
_Explain exactly how to report a suspected incident or vulnerability, who to contact, and what not to do, such as discussing it in public rooms._
</Alert>

## Incident response

1. **Contain** — _first actions to limit impact_
2. **Report** — _who to notify and how_
3. **Investigate** — _how evidence is gathered and preserved_
4. **Recover** — _how systems are restored_
5. **Review** — _how lessons learned are recorded_

## On-call rota

| Week of | Primary | Secondary |
| ------- | ------- | --------- |
| _Date_ | _Name_ | _Name_ |
| _Date_ | _Name_ | _Name_ |

## Open vulnerabilities

| Identifier | Severity | Owner | Status |
| ---------- | -------- | ----- | ------ |
| _Reference_ | <Badge variant="destructive">High</Badge> | _Name_ | _Open, mitigated or fixed_ |

## Policies and standards

- _Acceptable use policy_
- _Access control and password policy_
- _Data classification and handling_
- _Compliance frameworks the organisation follows_

## Security checklist for new projects

- [ ] Threat model reviewed
- [ ] Secrets stored outside source code
- [ ] Dependencies scanned for known vulnerabilities
- [ ] _Add a check your team requires_

## Team

| Name | Role | Contact |
| ---- | ---- | ------- |
| _Add a name_ | _Role_ | _How to reach them_ |
`
};

export const officeTemplates: MdxTemplate[] = [
  generalOfficeTemplate,
  engineeringOfficeTemplate,
  designOfficeTemplate,
  securityOfficeTemplate,
];
