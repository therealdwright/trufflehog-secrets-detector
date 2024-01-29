const axios = require("axios");
const core = require("@actions/core");
const exec = require("@actions/exec");
const fs = require("fs");
const tar = require("tar");
const { Octokit } = require("@octokit/rest");

const token = process.env["GITHUB_TOKEN"];
const octokit = new Octokit({ auth: `token ${token}` });

const commit = core.getInput("commit");
const secretsFilePath = core.getInput("secrets-file");

async function downloadFile(url, outputPath) {
  const writer = require("fs").createWriteStream(outputPath);
  const response = await axios.get(url, { responseType: "stream" });
  response.data.pipe(writer);
  return new Promise((resolve, reject) => {
    writer.on("finish", resolve);
    writer.on("error", reject);
  });
}

async function checkForSecrets() {
  let secretsDetected = false;

  let data;
  try {
      data = fs.readFileSync(secretsFilePath, "utf8");
  } catch (err) {
      console.error(`Error reading file: ${err}`);
      throw err;
  }

  // If the file is empty or only contains an empty array, assume no secrets found
  if (!data || data.trim() === "[]") {
    console.log("No secrets found, skipping processing...");
    return secretsDetected;
  }

  const jsonData = JSON.parse(data);

  if (
    jsonData &&
    jsonData.SourceMetadata &&
    jsonData.SourceMetadata.Data &&
    jsonData.SourceMetadata.Data.Git &&
    jsonData.SourceMetadata.Data.Git.file
  ) {
    secretsDetected = true;

    const repoData = getRepoData(jsonData.SourceMetadata.Data.Git.repository);
    if (!repoData) {
      console.log("No repo data found, skipping processing...");
      return secretsDetected;
    }

    const commentBody = `🚨 Secret Detected 🚨\nSecret detected at line ${jsonData.SourceMetadata.Data.Git.line} in file ${jsonData.SourceMetadata.Data.Git.file}. Please review.`;

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
  }
  return secretsDetected;
}

function getRepoData(repoUrl) {
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

async function run() {
  // Ensure secrets.json exists at the start
  if (!fs.existsSync(secretsFilePath)) {
    fs.writeFileSync(secretsFilePath, "[]"); // Create an empty JSON array
  }

  try {
    const tarballPath = "./trufflehog.tar.gz";
    await downloadFile(
      "https://github.com/trufflesecurity/trufflehog/releases/download/v3.40.0/trufflehog_3.40.0_linux_amd64.tar.gz",
      tarballPath
    );
    await tar.x({ file: tarballPath });

    const options = {
      listeners: {
        stdout: (data) => {
          fs.appendFileSync(secretsFilePath, data.toString());
        },
        stderr: (data) => {
          console.error(data.toString());
        },
      },
    };

    try {
      await exec.exec(
        `./trufflehog`,
        [
          "git",
          "file://./",
          "--since-commit",
          `${commit}`,
          "--branch",
          "HEAD",
          "--fail",
          "--no-update",
          "--json",
          "--no-verification",
        ],
        options
      );
    } catch (error) {
      console.error(`Error executing trufflehog: ${error}`);
      throw error;
    }

    const secretsFound = await checkForSecrets();

    if (secretsFound) {
      core.setFailed("Secrets detected in the repository.");
    }
  } catch (error) {
    core.setFailed(`Action failed with error: ${error}`);
  }
}

run();
