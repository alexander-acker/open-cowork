import { tool } from '@langchain/core/tools';
import { z } from 'zod';

/**
 * Tool: Generate role-specific interview questions.
 */
export const generateInterviewQuestions = tool(
  async ({ role, questionType, count }) => {
    const numQuestions = Math.min(count || 5, 10);
    const templates: Record<string, string[]> = {
      behavioral: [
        `Tell me about a time you had to handle a difficult situation at work related to ${role}.`,
        `Describe a project where you demonstrated leadership in a ${role} capacity.`,
        `Give an example of when you had to make a tough decision with incomplete information.`,
        `Tell me about a time you failed and what you learned from it.`,
        `Describe how you handled a conflict with a colleague or stakeholder.`,
        `Share an experience where you had to adapt quickly to a change.`,
        `Tell me about your most impactful achievement in your career.`,
        `Describe a time you went above and beyond your role expectations.`,
        `How have you handled receiving critical feedback?`,
        `Tell me about a time you had to influence others without direct authority.`,
      ],
      technical: [
        `Walk me through how you would architect a system for [a common ${role} challenge].`,
        `What's your approach to debugging complex issues in production?`,
        `How do you stay current with developments in your field?`,
        `Describe your approach to testing and quality assurance.`,
        `How would you evaluate and choose between competing technical solutions?`,
        `What tools and methodologies do you rely on most in your daily work?`,
        `Describe your experience with [key technology for ${role}].`,
        `How do you approach performance optimization?`,
        `What's your strategy for managing technical debt?`,
        `How do you document and share knowledge with your team?`,
      ],
      situational: [
        `If you disagreed with your manager's direction on a project, what would you do?`,
        `How would you handle being assigned a project outside your expertise?`,
        `What would you do if you noticed a critical flaw close to a deadline?`,
        `How would you prioritize multiple urgent tasks as a ${role}?`,
        `If a team member wasn't contributing, how would you handle it?`,
        `How would you onboard yourself in the first 90 days of this role?`,
        `What would you do if a stakeholder kept changing requirements?`,
        `How would you handle a situation where your team missed a deadline?`,
        `What would you do if you strongly disagreed with a company policy?`,
        `How would you approach building relationships in a new organization?`,
      ],
    };

    const type = questionType || 'behavioral';
    const questions = (templates[type] || templates.behavioral).slice(0, numQuestions);

    return JSON.stringify({
      role,
      questionType: type,
      questions,
      tip: type === 'behavioral'
        ? 'Use the STAR method: Situation, Task, Action, Result'
        : type === 'technical'
          ? 'Think aloud, ask clarifying questions, and explain trade-offs'
          : 'Focus on demonstrating judgment, values, and problem-solving approach',
    });
  },
  {
    name: 'generate_interview_questions',
    description: 'Generate role-specific interview questions by type (behavioral, technical, situational). Use this to help users prepare for interviews.',
    schema: z.object({
      role: z.string().describe('The job role to generate questions for'),
      questionType: z.enum(['behavioral', 'technical', 'situational']).optional().describe('The type of interview questions'),
      count: z.number().optional().describe('Number of questions to generate (max 10)'),
    }),
  }
);

/**
 * Tool: Evaluate an interview answer using the STAR framework.
 */
export const evaluateAnswer = tool(
  async ({ question, answer }) => {
    const hasSituation = answer.length > 50; // Simplified check
    const hasTask = /task|goal|objective|needed to|responsible/i.test(answer);
    const hasAction = /I\s+(?:did|created|led|managed|developed|built|designed|implemented)/i.test(answer);
    const hasResult = /result|outcome|achieved|increased|reduced|saved|improved|learned/i.test(answer);

    const components = {
      situation: hasSituation,
      task: hasTask,
      action: hasAction,
      result: hasResult,
    };

    const score = Object.values(components).filter(Boolean).length;
    const missing = Object.entries(components)
      .filter(([, v]) => !v)
      .map(([k]) => k);

    return JSON.stringify({
      question,
      starAnalysis: components,
      score: `${score}/4`,
      missing,
      feedback: missing.length === 0
        ? 'Great answer structure! All STAR components are present.'
        : `Your answer is missing: ${missing.join(', ')}. ${
          missing.includes('result') ? 'Always end with the impact/outcome.' : ''
        }${missing.includes('action') ? ' Be specific about YOUR actions, not the team\'s.' : ''}`,
      lengthCheck: answer.split(/\s+/).length < 50
        ? 'Your answer may be too brief. Aim for 1-2 minutes when spoken.'
        : answer.split(/\s+/).length > 300
          ? 'Your answer may be too long. Keep it concise and focused.'
          : 'Good length for an interview response.',
    });
  },
  {
    name: 'evaluate_answer',
    description: 'Evaluate an interview answer against the STAR framework and provide structured feedback. Use when the user practices answering interview questions.',
    schema: z.object({
      question: z.string().describe('The interview question that was asked'),
      answer: z.string().describe('The user\'s answer to evaluate'),
    }),
  }
);

/**
 * Tool: Suggest questions for the candidate to ask the interviewer.
 */
export const suggestCandidateQuestions = tool(
  async ({ role, company, interviewStage }) => {
    const stage = interviewStage || 'general';
    const baseQuestions = [
      `What does a typical day look like for someone in this ${role} position?`,
      `What are the biggest challenges the team is currently facing?`,
      `How do you measure success for this role in the first 6 months?`,
      `What opportunities for growth and development are available?`,
      `Can you describe the team culture and how the team collaborates?`,
    ];

    const stageQuestions: Record<string, string[]> = {
      phone_screen: [
        'What does the rest of the interview process look like?',
        'What are the must-have qualifications for this role?',
      ],
      technical: [
        'What\'s the tech stack and how often does it evolve?',
        'How does the team approach code reviews and knowledge sharing?',
        'What does the deployment process look like?',
      ],
      final: [
        'What are the team\'s priorities for the next quarter?',
        `Why is this ${role} position open?`,
        'What would make someone exceptionally successful in this role?',
      ],
      general: [],
    };

    return JSON.stringify({
      role,
      company: company || 'the company',
      stage,
      questions: [...baseQuestions, ...(stageQuestions[stage] || [])],
      tip: 'Prepare 3-5 thoughtful questions. Avoid asking about salary/benefits in early rounds.',
    });
  },
  {
    name: 'suggest_candidate_questions',
    description: 'Suggest questions for the candidate to ask their interviewer. Use when helping users prepare questions to ask during interviews.',
    schema: z.object({
      role: z.string().describe('The role being interviewed for'),
      company: z.string().optional().describe('The company name for tailored questions'),
      interviewStage: z.enum(['phone_screen', 'technical', 'final', 'general']).optional().describe('The interview stage'),
    }),
  }
);

export const interviewTools = [generateInterviewQuestions, evaluateAnswer, suggestCandidateQuestions];
