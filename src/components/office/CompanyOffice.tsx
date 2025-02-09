
import { BaseOffice } from "./BaseOffice";

const getInitialContent = (currentRoom: string | null) => {
  switch(currentRoom) {
    case "main":
      return `
# Executive Office 🏢

## Today's Priorities

<Alert title="Important Updates">
Board meeting scheduled for 3 PM - Q1 performance review and strategy discussion
</Alert>

## Company Overview

<Card title="Key Metrics" description="Q1 2024">
- Revenue Growth: +15%
- Customer Satisfaction: 92%
- Employee Engagement: 88%

<Badge>Exceeding Targets</Badge>
<Badge variant="secondary">Strong Performance</Badge>
</Card>

## Executive Calendar

<Table data={[
  { time: '9:00', event: 'Leadership Sync', location: 'Main Office' },
  { time: '11:00', event: 'Investor Call', location: 'Conference Line' },
  { time: '15:00', event: 'Board Meeting', location: 'Board Room' }
]} />
`;

    case "meeting-a":
      return `
# Meeting Room A - Strategy Hub 🎯

## Room Schedule

<Alert title="Next Meeting">
Product Strategy Review - Starting in 30 minutes
</Alert>

## Meeting Resources

<Card title="Available Equipment" description="Room Facilities">
- 4K Video Conference System
- Digital Whiteboard
- Seating Capacity: 12
- Presentation Screen

<Badge>Fully Equipped</Badge>
<Badge variant="secondary">Booking Required</Badge>
</Card>

## Today's Agenda

<Table data={[
  { time: '10:00', meeting: 'Product Strategy', organizer: 'Product Team' },
  { time: '13:00', meeting: 'Sales Pipeline Review', organizer: 'Sales Director' },
  { time: '15:30', meeting: 'Tech Architecture', organizer: 'CTO' }
]} />
`;

    case "meeting-b":
      return `
# Meeting Room B - Innovation Center 💡

## Room Status

<Alert title="Current Setup">
Room configured for workshop-style meetings with breakout areas
</Alert>

## Room Features

<Card title="Collaboration Tools" description="Available Resources">
- Interactive Smart Boards
- Modular Furniture
- Design Thinking Tools
- Innovation Workshops Kit

<Badge>Innovation Space</Badge>
<Badge variant="secondary">Creative Zone</Badge>
</Card>

## Workshop Schedule

<Table data={[
  { time: '9:30', activity: 'Innovation Workshop', facilitator: 'R&D Team' },
  { time: '13:30', activity: 'Design Sprint', facilitator: 'UX Team' },
  { time: '16:00', activity: 'Tech Demo', facilitator: 'Engineering' }
]} />
`;

    default:
      return `
# Welcome to Company Office 🏢

## Today's Updates

<Alert title="Important Notice">
Team meeting scheduled for 2 PM today in the main conference room.
</Alert>

## Project Overview

<Card title="Current Sprint" description="Sprint 23 - Week 2">
- Feature development in progress
- Code reviews pending
- QA testing scheduled

<Badge>In Progress</Badge>
<Badge variant="secondary">High Priority</Badge>
</Card>

## Team Schedule

<Table data={[
  { time: '9:00', monday: 'Standup', tuesday: 'Planning', wednesday: 'Review' },
  { time: '11:00', monday: 'Dev', tuesday: 'Dev', wednesday: 'Testing' },
  { time: '14:00', monday: 'Review', tuesday: 'Testing', wednesday: 'Deploy' }
]} />
`;
  }
};

export const CompanyOffice = () => {
  return <BaseOffice title="Company" getInitialContent={getInitialContent} />;
};
