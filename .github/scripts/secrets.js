const fs = require("fs");
const { Octokit } = require("@octokit/rest");

const token = process.env["GITHUB_TOKEN"];
const octokit = new Octokit({ auth: `token ${token}` });

const filePath = "./secrets.json"; // replace with your JSON file path

fs.readFile(filePath, "utf8", async (err, data) => {
  if (err) {
    if (!data) {
      console.log("No data found, skipping processing...");
      return;
    } else console.log(`Error reading file from disk: ${err}`);
  } else {
    const jsonData = JSON.parse(data);

    const repoData = getRepoData(jsonData.SourceMetadata.Data.Git.repository);
    if (!repoData) {
      console.log("No repo data found, skipping processing...");
      return;
    }
    const commentBody = `🚨 Secret Detected 🚨\nSecret detected at line ${jsonData.SourceMetadata.Data.Git.line} in file ${jsonData.SourceMetadata.Data.Git.file}. Please review.`;

    try {
      const prs = await octokit.pulls.list({
        owner: repoData.owner,
        repo: repoData.repo,
      });

      for (const pr of prs.data) {
        if (pr.state === "open") {
          const commitId = await octokit.repos.getCommit({
            owner: repoData.owner,
            repo: repoData.repo,
            ref: pr.head.sha,
          });

          await octokit.pulls.createReviewComment({
            owner: repoData.owner,
            repo: repoData.repo,
            pull_number: pr.number,
            body: commentBody,
            commit_id: commitId.data.sha,
            path: jsonData.SourceMetadata.Data.Git.file,
            line: jsonData.SourceMetadata.Data.Git.line,
            side: "RIGHT", // assuming the secret was added, not removed
          });
        }
      }
    } catch (e) {
      if (
        e.status === 422 &&
        e.message.includes("PullRequestReviewComment") &&
        e.message.includes("pull_request_review_thread.path") &&
        e.message.includes("pull_request_review_thread.diff_hunk")
      ) {
        // Ignore the specific error relating to pull_request_review_thread.diff_hunk
      } else if (e.status) {
        console.log(`GitHub returned an error: ${e.status}`);
        console.log(e.message);
      } else {
        console.log("Error occurred", e);
      }
    }
  }
});

function getRepoData(repoUrl) {
  // This regex will handle both SSH and HTTPS URLs
  const regex =
    /(?:git@github\.com:|https:\/\/github.com\/)(.+)\/(.+)(?:\.git)?/i;
  const match = regex.exec(repoUrl);

  if (!match) {
    console.log(`No match found for repoUrl: ${repoUrl}`);
    return null;
  }

  return {
    owner: match[1],
    repo: match[2],
  };
}
