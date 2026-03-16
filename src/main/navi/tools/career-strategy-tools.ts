import { tool } from '@langchain/core/tools';
import { z } from 'zod';

/**
 * Tool: Perform a skill gap analysis.
 */
export const analyzeSkillGaps = tool(
  async ({ currentSkills, targetRole, targetIndustry }) => {
    // Common skill requirements by role category
    const roleSkillMap: Record<string, string[]> = {
      'software engineer': ['programming', 'system design', 'algorithms', 'version control', 'testing', 'CI/CD', 'cloud services', 'databases'],
      'data scientist': ['python', 'statistics', 'machine learning', 'SQL', 'data visualization', 'experiment design', 'deep learning'],
      'product manager': ['user research', 'roadmapping', 'data analysis', 'stakeholder management', 'agile', 'strategy', 'metrics'],
      'designer': ['user research', 'wireframing', 'prototyping', 'visual design', 'design systems', 'usability testing', 'figma'],
      'marketing': ['content strategy', 'analytics', 'SEO', 'social media', 'email marketing', 'brand strategy', 'copywriting'],
      'manager': ['leadership', 'hiring', 'performance management', 'strategic planning', 'budgeting', 'communication', 'conflict resolution'],
    };

    // Find the closest matching role category
    const roleLower = targetRole.toLowerCase();
    const matchedCategory = Object.keys(roleSkillMap).find(key => roleLower.includes(key)) || '';
    const requiredSkills = roleSkillMap[matchedCategory] || [
      'communication', 'problem-solving', 'leadership', 'technical proficiency', 'project management',
    ];

    const currentLower = currentSkills.map(s => s.toLowerCase());
    const gaps = requiredSkills.filter(skill => !currentLower.some(cs => cs.includes(skill) || skill.includes(cs)));
    const strengths = requiredSkills.filter(skill => currentLower.some(cs => cs.includes(skill) || skill.includes(cs)));

    return JSON.stringify({
      targetRole,
      targetIndustry: targetIndustry || 'general',
      requiredSkills,
      strengths,
      gaps,
      readinessScore: Math.round((strengths.length / requiredSkills.length) * 100),
      learningPlan: gaps.map(gap => ({
        skill: gap,
        priority: gaps.indexOf(gap) < 3 ? 'high' : 'medium',
        suggestion: `Study and practice ${gap} through online courses, projects, or mentorship`,
      })),
    });
  },
  {
    name: 'analyze_skill_gaps',
    description: 'Analyze the gap between current skills and target role requirements. Use when helping users understand what skills to develop for career transitions.',
    schema: z.object({
      currentSkills: z.array(z.string()).describe('The user\'s current skills'),
      targetRole: z.string().describe('The target role to analyze skills against'),
      targetIndustry: z.string().optional().describe('The target industry'),
    }),
  }
);

/**
 * Tool: Create a career roadmap with milestones.
 */
export const createCareerRoadmap = tool(
  async ({ currentRole, targetRole, timeframe, currentSkills }) => {
    const months = timeframe || 12;
    const phases = [];

    if (months >= 3) {
      phases.push({
        phase: 'Foundation (Months 1-3)',
        goals: [
          'Audit current skills against target role requirements',
          'Begin filling top-priority skill gaps',
          'Start networking with people in target role',
          'Update LinkedIn and online presence',
        ],
      });
    }

    if (months >= 6) {
      phases.push({
        phase: 'Building (Months 4-6)',
        goals: [
          'Complete key certifications or courses',
          'Take on stretch projects in current role that align with target',
          'Build a portfolio or evidence of relevant work',
          'Attend industry events or join professional groups',
        ],
      });
    }

    if (months >= 9) {
      phases.push({
        phase: 'Positioning (Months 7-9)',
        goals: [
          'Refine resume and tailor to target roles',
          'Begin informational interviews at target companies',
          'Seek internal opportunities if applicable',
          'Practice interviewing with peer feedback',
        ],
      });
    }

    if (months >= 12) {
      phases.push({
        phase: 'Executing (Months 10-12)',
        goals: [
          'Actively apply to target positions',
          'Leverage network connections for referrals',
          'Negotiate offers strategically',
          'Plan your transition and onboarding',
        ],
      });
    }

    return JSON.stringify({
      currentRole: currentRole || 'current position',
      targetRole,
      timeframeMonths: months,
      phases,
      keyMetrics: [
        'Number of skills acquired/improved',
        'Network connections in target field',
        'Applications submitted',
        'Interviews secured',
        'Offers received',
      ],
      currentSkills: currentSkills || [],
    });
  },
  {
    name: 'create_career_roadmap',
    description: 'Create a phased career roadmap with milestones for transitioning between roles. Use when users want long-term career planning guidance.',
    schema: z.object({
      currentRole: z.string().optional().describe('The user\'s current role'),
      targetRole: z.string().describe('The desired target role'),
      timeframe: z.number().optional().describe('Timeframe in months (default: 12)'),
      currentSkills: z.array(z.string()).optional().describe('Current skills for context'),
    }),
  }
);

/**
 * Tool: Evaluate a career decision between options.
 */
export const evaluateCareerDecision = tool(
  async ({ options, priorities }) => {
    const criteria = priorities || ['growth', 'compensation', 'work-life balance', 'learning', 'stability'];

    const evaluation = options.map(option => ({
      option,
      considerations: criteria.map(criterion => ({
        criterion,
        question: `How does "${option}" rate on ${criterion}? (Consider this carefully)`,
      })),
    }));

    return JSON.stringify({
      options,
      criteria,
      framework: evaluation,
      decisionProcess: [
        '1. Score each option 1-10 on each criterion',
        '2. Weight the criteria by your personal priorities',
        '3. Calculate weighted scores for each option',
        '4. Consider gut feeling — if the "winner" doesn\'t feel right, explore why',
        '5. Talk to people who\'ve faced similar decisions',
      ],
      tip: 'The best career decisions align with both your values and your long-term vision. Short-term discomfort for long-term growth is often worth it.',
    });
  },
  {
    name: 'evaluate_career_decision',
    description: 'Provide a structured framework for evaluating between career options. Use when users need help deciding between job offers, career paths, or opportunities.',
    schema: z.object({
      options: z.array(z.string()).describe('The career options to evaluate'),
      priorities: z.array(z.string()).optional().describe('Decision criteria to evaluate against'),
    }),
  }
);

export const careerStrategyTools = [analyzeSkillGaps, createCareerRoadmap, evaluateCareerDecision];
