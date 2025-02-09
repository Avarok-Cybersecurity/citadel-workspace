
import { BaseOffice } from "./BaseOffice";

const getInitialContent = (currentRoom: string | null) => {
  switch(currentRoom) {
    case "training":
      return `
# Training & Development Center 📚

## Today's Sessions

<Alert title="Upcoming Training">
Leadership Development Workshop - Starting at 10 AM in the main training room
</Alert>

## Learning Resources

<Card title="Available Materials" description="Training Tools">
- Interactive Learning Platforms
- Virtual Reality Training Sets
- Professional Development Library
- Workshop Materials

<Badge>Professional Development</Badge>
<Badge variant="secondary">Certified Programs</Badge>
</Card>

## Training Schedule

<Table data={[
  { time: '9:00', course: 'New Employee Orientation', instructor: 'HR Team' },
  { time: '11:00', course: 'Leadership Skills', instructor: 'External Coach' },
  { time: '14:00', course: 'Technical Training', instructor: 'IT Department' }
]} />
`;

    case "interview-a":
      return `
# Interview Room A - Recruitment Hub 🤝

## Today's Schedule

<Alert title="Next Interview">
Senior Developer Position - Candidate arriving at 11 AM
</Alert>

## Position Details

<Card title="Open Roles" description="Current Vacancies">
- Senior Developer (3 positions)
- Product Manager (1 position)
- UX Designer (2 positions)

<Badge>Active Hiring</Badge>
<Badge variant="secondary">Priority Roles</Badge>
</Card>

## Interview Schedule

<Table data={[
  { time: '10:00', position: 'UX Designer', interviewer: 'Design Lead' },
  { time: '11:00', position: 'Senior Developer', interviewer: 'Tech Lead' },
  { time: '14:00', position: 'Product Manager', interviewer: 'CPO' }
]} />
`;

    case "interview-b":
      return `
# Interview Room B - Assessment Center 📋

## Room Status

<Alert title="Current Activity">
Group assessment for Management Trainee positions
</Alert>

## Assessment Tools

<Card title="Available Resources" description="Evaluation Materials">
- Psychometric Tests
- Case Study Materials
- Group Exercise Tools
- Assessment Forms

<Badge>Professional Assessment</Badge>
<Badge variant="secondary">Structured Evaluation</Badge>
</Card>

## Assessment Schedule

<Table data={[
  { time: '9:30', activity: 'Group Discussion', assessor: 'HR Manager' },
  { time: '11:30', activity: 'Case Presentations', assessor: 'Department Heads' },
  { time: '14:30', activity: 'Individual Interviews', assessor: 'Senior Management' }
]} />
`;

    default:
      return `
# Human Resources Department 👥

## Important Announcements

<Alert title="Upcoming Events">
Annual performance reviews starting next week - Schedule your meeting with your manager
</Alert>

## HR Metrics

<Card title="Team Statistics" description="Current Month">
- Total Employees: 150
- New Hires: 5
- Open Positions: 3

<Badge>Growing Team</Badge>
<Badge variant="secondary">Active Hiring</Badge>
</Card>

## Training Schedule

<Table data={[
  { course: 'Leadership Skills', date: 'Monday', time: '10:00 AM', location: 'Room 301' },
  { course: 'DEI Workshop', date: 'Wednesday', time: '2:00 PM', location: 'Main Hall' },
  { course: 'Tech Skills', date: 'Friday', time: '11:00 AM', location: 'Room 205' }
]} />
`;
  }
};

export const HROffice = () => {
  return <BaseOffice title="Human Resources" getInitialContent={getInitialContent} />;
};
