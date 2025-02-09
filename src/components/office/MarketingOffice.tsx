
import { BaseOffice } from "./BaseOffice";

const getInitialContent = (currentRoom: string | null) => {
  switch(currentRoom) {
    case "creative":
      return `
# Creative Studio - Design Hub 🎨

## Project Status

<Alert title="Active Projects">
Brand refresh project entering final phase - Review meeting at 2 PM
</Alert>

## Design Resources

<Card title="Available Tools" description="Creative Suite">
- Adobe Creative Cloud
- 3D Rendering Station
- Photography Equipment
- Digital Drawing Tablets

<Badge>Professional Tools</Badge>
<Badge variant="secondary">High-End Equipment</Badge>
</Card>

## Creative Schedule

<Table data={[
  { time: '9:00', project: 'Brand Design', team: 'Visual Design' },
  { time: '11:30', project: 'Video Editing', team: 'Media Team' },
  { time: '14:00', project: 'Photo Shoot', team: 'Content Team' }
]} />
`;

    case "conference":
      return `
# Marketing Conference Room 📊

## Today's Agenda

<Alert title="Upcoming Presentation">
Client presentation for new campaign concept - 11 AM
</Alert>

## Campaign Analytics

<Card title="Current Performance" description="Q1 Campaign">
- Social Media Reach: 2.5M
- Engagement Rate: 4.8%
- Lead Generation: +35%

<Badge>Exceeding Goals</Badge>
<Badge variant="secondary">High Impact</Badge>
</Card>

## Meeting Schedule

<Table data={[
  { time: '10:00', meeting: 'Campaign Review', client: 'Tech Corp' },
  { time: '13:00', meeting: 'Strategy Planning', client: 'Internal' },
  { time: '15:00', meeting: 'Content Calendar', client: 'Fashion Brand' }
]} />
`;

    case "media":
      return `
# Media Production Room 🎥

## Studio Status

<Alert title="Equipment Notice">
New 4K cameras available for content creation
</Alert>

## Production Equipment

<Card title="Available Gear" description="Professional Setup">
- 4K Video Cameras
- Lighting Equipment
- Sound Recording Studio
- Green Screen Setup

<Badge>Professional Grade</Badge>
<Badge variant="secondary">Full Studio</Badge>
</Card>

## Production Schedule

<Table data={[
  { time: '9:00', project: 'Product Showcase', type: 'Video' },
  { time: '11:00', project: 'Podcast Recording', type: 'Audio' },
  { time: '14:00', project: 'Social Media Content', type: 'Mixed Media' }
]} />
`;

    default:
      return `
# PR & Marketing Department 📢

## Current Campaigns

<Alert title="Active Campaign">
Q1 Product Launch Campaign in progress - All hands meeting at 3 PM
</Alert>

## Marketing Metrics

<Card title="Campaign Performance" description="Last 30 Days">
- Social Media Engagement: +25%
- Website Traffic: 50k visitors
- Lead Generation: 1,200 new leads

<Badge>Trending Up</Badge>
<Badge variant="secondary">High Impact</Badge>
</Card>

## Content Calendar

<Table data={[
  { date: 'Mon', content: 'Blog Post', platform: 'Website', status: 'Draft' },
  { date: 'Wed', content: 'Product Video', platform: 'YouTube', status: 'Planning' },
  { date: 'Fri', content: 'Newsletter', platform: 'Email', status: 'Scheduled' }
]} />
`;
  }
};

export const MarketingOffice = () => {
  return <BaseOffice title="PR/Marketing" getInitialContent={getInitialContent} />;
};
