/**
 * Room MDX Templates
 *
 * Pre-defined MDX content templates for room types.
 */

import { TemplateCategory, TemplateTheme, type MdxTemplate } from './types';

export const meetingRoomTemplate: MdxTemplate = {
  id: 'room-meeting',
  name: 'Meeting Room',
  description: 'A dedicated space for team meetings and discussions',
  category: TemplateCategory.NESTED,
  type: TemplateTheme.MEETING,
  content: `# Team Meeting Room

<Card title="About this room" description="Which meetings happen here">

_List the recurring meetings this room is for, and who usually attends._

</Card>

## Upcoming meetings

| Date | Meeting | Facilitator |
| ---- | ------- | ----------- |
| _Date and time_ | _Meeting name_ | _Name_ |
| _Date and time_ | _Meeting name_ | _Name_ |

## Agenda for the next meeting

1. _Topic — owner — time allowed_
2. _Topic — owner — time allowed_
3. _Any other business_

## Action items

- [ ] _Action — owner — due date_
- [ ] _Action — owner — due date_

## Notes from past meetings

### _Date — meeting name_

- **Decisions:** _What was agreed_
- **Open questions:** _What still needs an answer_

## Meeting guidelines

- _Share the agenda before the meeting_
- _Start and end on time_
- _Record decisions and action items here_
`
};

export const projectsRoomTemplate: MdxTemplate = {
  id: 'room-projects',
  name: 'Projects Room',
  description: 'A room for tracking and collaborating on projects',
  category: TemplateCategory.NESTED,
  type: TemplateTheme.PROJECTS,
  content: `# Projects Hub

<Card title="About this room" description="How projects are tracked here">

_Explain which projects are tracked in this room and how often this page is updated._

</Card>

## Active projects

| Project | Lead | Target date | Status |
| ------- | ---- | ----------- | ------ |
| _Project name_ | _Name_ | _Date_ | <Badge>In Progress</Badge> |
| _Project name_ | _Name_ | _Date_ | <Badge variant="secondary">Planned</Badge> |

## Milestones

- [ ] _Milestone — target date_
- [ ] _Milestone — target date_
- [ ] _Milestone — target date_

## Team assignments

| Person | Project | Responsibility |
| ------ | ------- | -------------- |
| _Name_ | _Project name_ | _What they own_ |

## Risks and blockers

> _Record anything that could delay a project, who owns it, and what is being done about it._

## Status updates

### _Date_

- **Done:** _What was completed_
- **Next:** _What comes next_
- **Blocked:** _Anything waiting on someone else_

## Project documents

- _Project brief_
- _Requirements or specifications_
- _Decision log_
`
};

export const documentationRoomTemplate: MdxTemplate = {
  id: 'room-documentation',
  name: 'Documentation Room',
  description: 'A central repository for team and product documentation',
  category: TemplateCategory.NESTED,
  type: TemplateTheme.DOCUMENTATION,
  content: `# Documentation Center

<Card title="Getting started" description="Where to begin">

_Tell new readers which document to read first, and summarise what this documentation covers._

</Card>

## Product documentation

- _Product overview_
- _Feature guides_
- _Release notes_

## API reference

- _Authentication_
- _Endpoints or functions_
- _Error codes_

Example request:

\`\`\`bash
# Replace with a real example for your API
curl https://example.com/api/resource
\`\`\`

## User guides

1. _Guide title — one line on what it covers_
2. _Guide title — one line on what it covers_

## Internal processes

- _How we release_
- _How we handle support requests_
- _Who owns which documents_

## Contributing to the docs

<Alert title="Keep documents current">
_Explain how to propose a change, who reviews it, and how to mark a document as out of date._
</Alert>

## Recently updated

| Document | Updated | By |
| -------- | ------- | -- |
| _Document name_ | _Date_ | _Name_ |
`
};

export const trainingRoomTemplate: MdxTemplate = {
  id: 'room-training',
  name: 'Training Room',
  description: 'A space for learning and professional development',
  category: TemplateCategory.NESTED,
  type: TemplateTheme.TRAINING,
  content: `# Training Center

<Card title="About this room" description="Learning and development for the team">

_Describe what people can learn here and who to contact about training._

</Card>

## Learning paths

### _Path name, e.g. new starter_

- [ ] _Module or course_
- [ ] _Module or course_
- [ ] _Practical exercise_

## Upcoming sessions

| Date | Session | Trainer | How to join |
| ---- | ------- | ------- | ----------- |
| _Date and time_ | _Session title_ | _Name_ | _Room or link_ |

## Learning resources

- _Recommended courses_
- _Books and articles_
- _Internal recordings_

## Knowledge base

_Answer the questions people ask most often, or link to where the answers live._

## Certifications

| Certification | Who holds it | Renewal date |
| ------------- | ------------ | ------------ |
| _Certification name_ | _Name_ | _Date_ |

## Training materials

- _Slides_
- _Exercises and worksheets_
- _Assessments_

## Feedback

_Explain how attendees can share feedback on a session and how it will be used._
`
};

export const roomTemplates: MdxTemplate[] = [
  meetingRoomTemplate,
  projectsRoomTemplate,
  documentationRoomTemplate,
  trainingRoomTemplate,
];
