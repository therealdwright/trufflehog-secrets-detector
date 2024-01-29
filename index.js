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

  const data = await fs.readFile(secretsFilePath, "utf8");
  if (!data || data.trim().length === 0) {
    console.log("No data or empty file found, skipping processing...");
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
  try {
    const tarballPath = "./trufflehog.tar.gz";
    await downloadFile(
      "https://github.com/trufflesecurity/trufflehog/releases/download/v3.40.0/trufflehog_3.40.0_linux_amd64.tar.gz",
      tarballPath
    );
    await tar.x({ file: tarballPath });

    let output = "";
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
      fs.writeFileSync(secretsFilePath, output);
    } catch (error) {
      console.error(`Error executing trufflehog: ${error}`);
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
