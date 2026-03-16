import { tool } from '@langchain/core/tools';
import { z } from 'zod';

/**
 * Tool: Analyze a resume and provide structured feedback.
 */
export const analyzeResume = tool(
  async ({ resumeText, targetRole }) => {
    const sections = {
      hasContactInfo: /email|phone|linkedin/i.test(resumeText),
      hasSummary: /summary|objective|profile/i.test(resumeText),
      hasExperience: /experience|employment|work history/i.test(resumeText),
      hasEducation: /education|degree|university|college/i.test(resumeText),
      hasSkills: /skills|technologies|proficienc/i.test(resumeText),
      wordCount: resumeText.split(/\s+/).length,
    };

    const issues: string[] = [];
    if (!sections.hasContactInfo) issues.push('Missing contact information section');
    if (!sections.hasSummary) issues.push('Missing professional summary/objective');
    if (!sections.hasExperience) issues.push('Missing work experience section');
    if (!sections.hasEducation) issues.push('Missing education section');
    if (!sections.hasSkills) issues.push('Missing skills section');
    if (sections.wordCount < 150) issues.push('Resume appears too short (under 150 words)');
    if (sections.wordCount > 1000) issues.push('Resume may be too long (over 1000 words) for a single page');

    const hasActionVerbs = /led|managed|developed|created|implemented|designed|optimized|increased|reduced|built/i.test(resumeText);
    if (!hasActionVerbs) issues.push('Consider using more action verbs (led, developed, implemented, etc.)');

    const hasMetrics = /\d+%|\$\d|increased by|reduced by|saved/i.test(resumeText);
    if (!hasMetrics) issues.push('Add quantifiable achievements (percentages, dollar amounts, metrics)');

    return JSON.stringify({
      sections,
      issues,
      targetRole: targetRole || 'general',
      overallScore: Math.max(0, 100 - issues.length * 12),
      recommendation: issues.length === 0
        ? 'Resume structure looks solid. Focus on tailoring content to specific roles.'
        : `Found ${issues.length} area(s) to improve. Address these for a stronger resume.`,
    });
  },
  {
    name: 'analyze_resume',
    description: 'Analyze a resume text and provide structured feedback on sections, issues, and scoring. Use this when the user shares their resume or asks for a resume review.',
    schema: z.object({
      resumeText: z.string().describe('The full text of the resume to analyze'),
      targetRole: z.string().optional().describe('The target job role to tailor feedback for'),
    }),
  }
);

/**
 * Tool: Generate ATS-optimized keyword suggestions.
 */
export const suggestKeywords = tool(
  async ({ jobDescription, currentResume }) => {
    // Find words in JD not in resume (simplified keyword gap analysis)
    const commonSkillPatterns = [
      'python', 'javascript', 'typescript', 'react', 'node', 'aws', 'azure', 'gcp',
      'docker', 'kubernetes', 'sql', 'nosql', 'mongodb', 'postgresql', 'redis',
      'agile', 'scrum', 'kanban', 'ci/cd', 'devops', 'microservices', 'rest', 'graphql',
      'machine learning', 'data analysis', 'project management', 'leadership',
      'communication', 'problem-solving', 'collaboration', 'strategic planning',
    ];

    const missingKeywords = commonSkillPatterns.filter(
      keyword => jobDescription.toLowerCase().includes(keyword) && !currentResume.toLowerCase().includes(keyword)
    );

    // Extract action-oriented phrases from JD
    const actionPhrases = jobDescription.match(/(?:responsible for|experience with|knowledge of|ability to|skilled in)\s+[^.;,]+/gi) || [];

    return JSON.stringify({
      missingKeywords,
      suggestedPhrases: actionPhrases.slice(0, 8),
      matchRate: Math.round(((commonSkillPatterns.length - missingKeywords.length) / Math.max(commonSkillPatterns.length, 1)) * 100),
      tip: 'Naturally incorporate missing keywords into your experience descriptions. Don\'t just list them in a skills section.',
    });
  },
  {
    name: 'suggest_keywords',
    description: 'Compare a job description against a resume and suggest missing ATS-optimized keywords. Use this when helping tailor a resume to a specific job posting.',
    schema: z.object({
      jobDescription: z.string().describe('The job description to extract keywords from'),
      currentResume: z.string().describe('The current resume text to compare against'),
    }),
  }
);

/**
 * Tool: Generate a tailored bullet point for a work experience entry.
 */
export const generateBulletPoint = tool(
  async ({ achievement, targetRole, industry }) => {
    return JSON.stringify({
      original: achievement,
      suggestions: [
        `Use the STAR format: Situation → Task → Action → Result`,
        `Start with a strong action verb relevant to ${targetRole || 'the role'}`,
        `Include a quantifiable metric if possible (%, $, time saved)`,
        `Align the language with ${industry || 'the target industry'} terminology`,
      ],
      framework: 'ACTION VERB + WHAT you did + HOW you did it + RESULT/IMPACT (with numbers)',
    });
  },
  {
    name: 'generate_bullet_point',
    description: 'Provide a framework and suggestions for improving a resume bullet point. Use when the user needs help writing achievement-oriented bullet points.',
    schema: z.object({
      achievement: z.string().describe('The raw achievement or responsibility to turn into a bullet point'),
      targetRole: z.string().optional().describe('The target role to tailor the bullet point for'),
      industry: z.string().optional().describe('The industry context'),
    }),
  }
);

export const resumeTools = [analyzeResume, suggestKeywords, generateBulletPoint];
