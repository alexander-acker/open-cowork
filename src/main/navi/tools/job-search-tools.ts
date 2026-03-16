import { tool } from '@langchain/core/tools';
import { z } from 'zod';

/**
 * Tool: Build a job search strategy based on user profile.
 */
export const buildSearchStrategy = tool(
  async ({ targetRole, skills, experience, location, preferences }) => {
    const strategy = {
      targetRole,
      searchTerms: [
        targetRole,
        ...(skills || []).slice(0, 5).map(s => `${targetRole} ${s}`),
      ],
      platforms: [
        { name: 'LinkedIn', priority: 'high', tip: 'Set job alerts and engage with content in your field' },
        { name: 'Indeed', priority: 'high', tip: 'Use advanced search filters for salary and location' },
        { name: 'Glassdoor', priority: 'medium', tip: 'Research company reviews alongside applications' },
        { name: 'Company career pages', priority: 'high', tip: 'Apply directly for better visibility' },
        { name: 'Industry-specific boards', priority: 'medium', tip: 'Find niche boards for your field' },
      ],
      weeklyPlan: {
        applications: '5-10 targeted applications per week (quality over quantity)',
        networking: '3-5 informational conversations or messages per week',
        skillBuilding: '2-3 hours per week on skill gaps',
        profileMaintenance: 'Update LinkedIn and portfolio weekly',
      },
      experienceLevel: experience || 'not specified',
      location: location || 'not specified',
      customTips: preferences
        ? `Tailored to preferences: ${JSON.stringify(preferences)}`
        : 'Complete your profile preferences for more targeted advice',
    };

    return JSON.stringify(strategy);
  },
  {
    name: 'build_search_strategy',
    description: 'Create a personalized job search strategy with platforms, search terms, and weekly plans. Use when the user wants to organize or improve their job search.',
    schema: z.object({
      targetRole: z.string().describe('The target job role'),
      skills: z.array(z.string()).optional().describe('Key skills the user has'),
      experience: z.string().optional().describe('Years/level of experience'),
      location: z.string().optional().describe('Preferred location or remote preference'),
      preferences: z.record(z.string(), z.string()).optional().describe('Additional preferences like salary range, company size'),
    }),
  }
);

/**
 * Tool: Evaluate job-candidate fit.
 */
export const evaluateJobFit = tool(
  async ({ jobDescription, userSkills, userExperience }) => {
    const jdLower = jobDescription.toLowerCase();
    const matchedSkills = userSkills.filter(skill => jdLower.includes(skill.toLowerCase()));
    const unmatchedSkills = userSkills.filter(skill => !jdLower.includes(skill.toLowerCase()));

    // Check experience level alignment
    const yearsMatch = jdLower.match(/(\d+)\+?\s*years?/);
    const requiredYears = yearsMatch ? parseInt(yearsMatch[1]) : null;

    const fitScore = Math.round((matchedSkills.length / Math.max(userSkills.length, 1)) * 100);

    return JSON.stringify({
      fitScore,
      matchedSkills,
      unmatchedSkills,
      requiredExperience: requiredYears ? `${requiredYears}+ years` : 'Not specified',
      userExperience: userExperience || 'Not provided',
      recommendation: fitScore >= 70
        ? 'Strong fit — apply with confidence and highlight your matched skills.'
        : fitScore >= 40
          ? 'Moderate fit — apply but emphasize transferable skills and quick learning ability.'
          : 'Lower fit — consider whether this is a stretch role you can grow into, or focus on closer matches.',
      applicationTip: 'Tailor your resume and cover letter to emphasize the matched skills and bridge any gaps.',
    });
  },
  {
    name: 'evaluate_job_fit',
    description: 'Evaluate how well a user\'s skills match a job description and provide a fit score. Use when the user wants to know if they should apply to a specific job.',
    schema: z.object({
      jobDescription: z.string().describe('The job description to evaluate against'),
      userSkills: z.array(z.string()).describe('The user\'s skills to match'),
      userExperience: z.string().optional().describe('The user\'s experience level'),
    }),
  }
);

/**
 * Tool: Generate a tailored cover letter outline.
 */
export const generateCoverLetterOutline = tool(
  async ({ jobTitle, company, keyQualifications, userHighlights }) => {
    return JSON.stringify({
      structure: {
        opening: `Express enthusiasm for the ${jobTitle} role at ${company}. Mention how you found the position and one compelling reason you're a great fit.`,
        bodyParagraph1: `Highlight your most relevant experience: ${userHighlights.slice(0, 2).join('; ')}. Connect these directly to the job requirements.`,
        bodyParagraph2: `Address key qualifications they're looking for: ${keyQualifications.slice(0, 3).join(', ')}. Give specific examples with results.`,
        closing: `Reiterate your interest, mention what excites you about ${company}'s mission or work, and include a clear call to action.`,
      },
      tips: [
        'Keep it under one page (250-400 words)',
        'Mirror language from the job description naturally',
        'Each paragraph should serve a distinct purpose',
        `Research ${company} and reference something specific about them`,
        'Proofread carefully — typos are an immediate disqualifier for many hiring managers',
      ],
    });
  },
  {
    name: 'generate_cover_letter_outline',
    description: 'Generate a structured cover letter outline tailored to a specific job and company. Use when the user needs help writing a cover letter.',
    schema: z.object({
      jobTitle: z.string().describe('The job title being applied for'),
      company: z.string().describe('The company name'),
      keyQualifications: z.array(z.string()).describe('Key qualifications from the job description'),
      userHighlights: z.array(z.string()).describe('User\'s most relevant achievements/experience'),
    }),
  }
);

export const jobSearchTools = [buildSearchStrategy, evaluateJobFit, generateCoverLetterOutline];
