import { Octokit } from '@octokit/rest';
import sgMail from '@sendgrid/mail';

// Environment variables
const {
  GITHUB_TOKEN,
  SLACK_WEBHOOK_URL,
  SENDGRID_API_KEY,
  NOTIFY_EMAIL,
  SENDER_EMAIL,
  REPO_OWNER,
  REPO_NAME,
} = process.env;

// Initialize clients
const octokit = new Octokit({ auth: GITHUB_TOKEN });
sgMail.setApiKey(SENDGRID_API_KEY);

// GitHub Models endpoint
const GITHUB_MODELS_URL = 'https://models.inference.ai.azure.com/chat/completions';

/**
 * Fetch issues created in the last 24 hours
 */
async function fetchRecentIssues() {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data: issues } = await octokit.issues.listForRepo({
    owner: REPO_OWNER,
    repo: REPO_NAME,
    state: 'open',
    since,
    per_page: 100,
  });

  // Filter to only issues created in last 24h (since filter includes updated issues too)
  const recentIssues = issues.filter(issue => {
    const createdAt = new Date(issue.created_at);
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    return createdAt >= cutoff && !issue.pull_request; // Exclude PRs
  });

  return recentIssues;
}

/**
 * Analyze an issue with GitHub Models (GPT-4o)
 */
async function analyzeIssue(issue) {
  const prompt = `Analyze this GitHub issue and provide a JSON response with your analysis.

Issue Title: ${issue.title}
Issue Body: ${issue.body || 'No description provided'}
Labels: ${issue.labels.map(l => l.name).join(', ') || 'None'}
Author: ${issue.user.login}

Respond with ONLY valid JSON in this exact format:
{
  "priority": "Critical" | "High" | "Medium" | "Low",
  "category": "Bug" | "Feature Request" | "Question" | "Documentation" | "Enhancement" | "Other",
  "summary": "1-2 sentence summary of the issue",
  "suggestedAction": "Recommended next step for the maintainer",
  "estimatedEffort": "Small" | "Medium" | "Large"
}`;

  const response = await fetch(GITHUB_MODELS_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${GITHUB_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 500,
      temperature: 0.3,
    }),
  });

  if (!response.ok) {
    throw new Error(`GitHub Models API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const text = data.choices[0].message.content;

  try {
    // Handle potential markdown code blocks in response
    const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/) || text.match(/```\s*([\s\S]*?)\s*```/);
    const jsonStr = jsonMatch ? jsonMatch[1] : text;
    return JSON.parse(jsonStr.trim());
  } catch {
    // If parsing fails, return a default analysis
    return {
      priority: 'Medium',
      category: 'Other',
      summary: issue.title,
      suggestedAction: 'Review the issue manually',
      estimatedEffort: 'Medium',
    };
  }
}

/**
 * Get priority emoji
 */
function getPriorityEmoji(priority) {
  const emojis = {
    'Critical': ':red_circle:',
    'High': ':large_orange_circle:',
    'Medium': ':large_yellow_circle:',
    'Low': ':large_green_circle:',
  };
  return emojis[priority] || ':white_circle:';
}

/**
 * Send Slack notification
 */
async function sendSlackNotification(analyzedIssues) {
  if (!SLACK_WEBHOOK_URL) {
    console.log('Slack webhook not configured, skipping Slack notification');
    return;
  }

  const blocks = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `New Issues: ${REPO_OWNER}/${REPO_NAME}`,
        emoji: true,
      },
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `*${analyzedIssues.length} new issue(s)* found in the last 24 hours`,
        },
      ],
    },
    { type: 'divider' },
  ];

  for (const { issue, analysis } of analyzedIssues) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${getPriorityEmoji(analysis.priority)} *<${issue.html_url}|#${issue.number}: ${issue.title}>*\n` +
              `*Priority:* ${analysis.priority} | *Category:* ${analysis.category} | *Effort:* ${analysis.estimatedEffort}\n` +
              `*Summary:* ${analysis.summary}\n` +
              `*Suggested Action:* ${analysis.suggestedAction}`,
      },
    });
    blocks.push({ type: 'divider' });
  }

  const response = await fetch(SLACK_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ blocks }),
  });

  if (!response.ok) {
    throw new Error(`Slack notification failed: ${response.statusText}`);
  }

  console.log('Slack notification sent successfully');
}

/**
 * Send email notification via SendGrid
 */
async function sendEmailNotification(analyzedIssues) {
  if (!SENDGRID_API_KEY || !NOTIFY_EMAIL) {
    console.log('SendGrid not configured, skipping email notification');
    return;
  }

  const priorityColors = {
    'Critical': '#dc3545',
    'High': '#fd7e14',
    'Medium': '#ffc107',
    'Low': '#28a745',
  };

  const issueRows = analyzedIssues.map(({ issue, analysis }) => `
    <tr>
      <td style="padding: 12px; border-bottom: 1px solid #eee;">
        <span style="display: inline-block; width: 12px; height: 12px; border-radius: 50%; background-color: ${priorityColors[analysis.priority] || '#6c757d'}; margin-right: 8px;"></span>
        <a href="${issue.html_url}" style="color: #0366d6; text-decoration: none; font-weight: 600;">#${issue.number}: ${issue.title}</a>
      </td>
    </tr>
    <tr>
      <td style="padding: 0 12px 12px 32px; border-bottom: 1px solid #eee; color: #586069;">
        <strong>Priority:</strong> ${analysis.priority} |
        <strong>Category:</strong> ${analysis.category} |
        <strong>Effort:</strong> ${analysis.estimatedEffort}<br>
        <strong>Summary:</strong> ${analysis.summary}<br>
        <strong>Suggested Action:</strong> ${analysis.suggestedAction}
      </td>
    </tr>
  `).join('');

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; line-height: 1.5; color: #24292e; max-width: 600px; margin: 0 auto; padding: 20px;">
      <h1 style="font-size: 24px; border-bottom: 1px solid #eee; padding-bottom: 10px;">
        New Issues: ${REPO_OWNER}/${REPO_NAME}
      </h1>
      <p style="color: #586069;">
        <strong>${analyzedIssues.length} new issue(s)</strong> found in the last 24 hours
      </p>
      <table style="width: 100%; border-collapse: collapse; margin-top: 20px;">
        ${issueRows}
      </table>
      <p style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; color: #586069; font-size: 12px;">
        This email was generated by the GitHub Issue Monitor AI Agent.
      </p>
    </body>
    </html>
  `;

  const msg = {
    to: NOTIFY_EMAIL,
    from: SENDER_EMAIL || 'noreply@github-issue-monitor.com',
    subject: `[${REPO_OWNER}/${REPO_NAME}] ${analyzedIssues.length} New Issue(s) - AI Analysis`,
    html,
  };

  await sgMail.send(msg);
  console.log('Email notification sent successfully');
}

/**
 * Main function
 */
async function main() {
  console.log(`Checking for new issues in ${REPO_OWNER}/${REPO_NAME}...`);

  // Fetch recent issues
  const issues = await fetchRecentIssues();
  console.log(`Found ${issues.length} new issue(s) in the last 24 hours`);

  if (issues.length === 0) {
    console.log('No new issues to report');
    return;
  }

  // Analyze each issue with Claude
  console.log('Analyzing issues with Claude AI...');
  const analyzedIssues = [];

  for (const issue of issues) {
    console.log(`Analyzing issue #${issue.number}: ${issue.title}`);
    const analysis = await analyzeIssue(issue);
    analyzedIssues.push({ issue, analysis });
  }

  // Send notifications
  console.log('Sending notifications...');

  await Promise.all([
    sendSlackNotification(analyzedIssues),
    sendEmailNotification(analyzedIssues),
  ]);

  console.log('Done!');
}

// Run
main().catch(error => {
  console.error('Error:', error);
  process.exit(1);
});
