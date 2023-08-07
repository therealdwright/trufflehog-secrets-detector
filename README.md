# Trufflehog PR Commenter Action 🚨

A GitHub Action that scans a repository for secrets using Trufflehog, and if any are found, comments on the associated pull request with details.

## 🚀 Features

- Scans the repository for secrets.
- Leaves a comment on the pull request if a secret is detected.
- Uses the Trufflehog tool for deep and accurate secret scanning.

## 🛠️ Usage

Add the following step to your GitHub Actions workflow:

```yaml
- name: Trufflehog PR Commenter
  uses: therealdwright/trufflehog-secrets-detector@v1.0.0
  with:
    secrets-file: 'path_to_output.json' # Optional, defaults to 'secrets.json'
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

## Inputs

| Name          | Description                                           | Default         |
|---------------|-------------------------------------------------------|-----------------|
| `secrets-file`| The path where the Trufflehog JSON output will be saved| `secrets.json`  |

## Prerequisites

- The action assumes that the repository has already been checked out.
- Node.js is set up in the runner environment.

## 💡 Notes

- Ensure that the workflow has access to the `GITHUB_TOKEN` to leave comments on pull requests.
- This action is optimized to run on a Node.js environment.

## 📖 References

- [Trufflehog](https://github.com/trufflesecurity/trufflehog)

## 📜 License

This GitHub Action is distributed under the [MIT License](LICENSE).
