import { tool } from '@langchain/core/tools';
import { z } from 'zod';

/**
 * Tool: Generate networking outreach message templates.
 */
export const generateOutreachMessage = tool(
  async ({ recipientRole, purpose, context, platform }) => {
    const templates: Record<string, string> = {
      informational_interview: `Hi [Name],

I'm ${context || 'exploring opportunities'} in the ${recipientRole} space and came across your profile. Your experience with [specific aspect] really stood out to me.

Would you be open to a brief 15-20 minute conversation? I'd love to learn about your career path and any insights you'd be willing to share about the field.

Thank you for considering!`,
      referral: `Hi [Name],

I hope this message finds you well. I noticed that [Company] has an open ${recipientRole} position, and given your connection there, I wanted to reach out.

I have [brief relevant experience], and I believe I'd be a strong fit for the role. Would you be comfortable referring me or sharing any insights about the team?

I'd be happy to send my resume for your review. Thanks so much!`,
      reconnect: `Hi [Name],

It's been a while since we last connected! I hope you've been doing well.

I'm currently ${context || 'exploring new opportunities'} and wanted to reconnect. I'd love to hear what you've been up to and catch up.

Would you have time for a quick chat in the coming weeks?`,
      cold_outreach: `Hi [Name],

I'm reaching out because I admire the work you've done in [specific area]. As someone ${context || 'building a career'} in a similar space, I'd value your perspective.

Would you be open to a brief conversation? I have a few specific questions about ${recipientRole} that I think your experience could really help with.

Thank you for your time!`,
    };

    const messageType = purpose || 'informational_interview';
    const template = templates[messageType] || templates.informational_interview;

    return JSON.stringify({
      template,
      platform: platform || 'linkedin',
      tips: [
        'Personalize every message — reference something specific about them',
        'Keep it concise (under 150 words for LinkedIn)',
        'Make the ask clear and low-commitment',
        'Follow up once after 5-7 days if no response',
        'Always express gratitude regardless of outcome',
      ],
      doNot: [
        'Don\'t send generic copy-paste messages',
        'Don\'t immediately ask for a job',
        'Don\'t write more than a few short paragraphs',
        'Don\'t be discouraged by non-responses (30% response rate is good)',
      ],
    });
  },
  {
    name: 'generate_outreach_message',
    description: 'Generate networking outreach message templates for LinkedIn, email, etc. Use when the user needs help reaching out to professionals.',
    schema: z.object({
      recipientRole: z.string().describe('The role/title of the person being contacted'),
      purpose: z.enum(['informational_interview', 'referral', 'reconnect', 'cold_outreach']).optional().describe('Purpose of the outreach'),
      context: z.string().optional().describe('User\'s context or reason for reaching out'),
      platform: z.enum(['linkedin', 'email', 'twitter']).optional().describe('The platform for the message'),
    }),
  }
);

/**
 * Tool: Create a networking action plan.
 */
export const createNetworkingPlan = tool(
  async ({ targetIndustry, currentNetwork, goals }) => {
    return JSON.stringify({
      targetIndustry: targetIndustry || 'your target industry',
      weeklyActions: [
        { action: 'Send 3-5 personalized connection requests', platform: 'LinkedIn' },
        { action: 'Engage with 5-10 posts from industry leaders', platform: 'LinkedIn/Twitter' },
        { action: 'Attend 1 virtual or in-person networking event', platform: 'Meetup/Eventbrite' },
        { action: 'Have 1-2 informational conversations', platform: 'Zoom/Coffee' },
        { action: 'Share 1 piece of valuable content or insight', platform: 'LinkedIn' },
      ],
      networkBuilding: [
        'Map your existing network and identify gaps',
        'Join 2-3 relevant professional groups or communities',
        'Volunteer for industry events or organizations',
        'Offer help before asking for favors',
        'Maintain a simple CRM (spreadsheet) to track relationships',
      ],
      currentNetworkSize: currentNetwork || 'unknown',
      goals: goals || ['Expand professional network', 'Find mentors', 'Discover opportunities'],
      keyPrinciple: 'Networking is about building genuine relationships, not collecting contacts. Focus on how you can add value to others.',
    });
  },
  {
    name: 'create_networking_plan',
    description: 'Create a structured networking plan with weekly actions and strategies. Use when users want to build or strengthen their professional network.',
    schema: z.object({
      targetIndustry: z.string().optional().describe('The industry to focus networking efforts on'),
      currentNetwork: z.string().optional().describe('Description of current network size/quality'),
      goals: z.array(z.string()).optional().describe('Specific networking goals'),
    }),
  }
);

export const networkingTools = [generateOutreachMessage, createNetworkingPlan];
