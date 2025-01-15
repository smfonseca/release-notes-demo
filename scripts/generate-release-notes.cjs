const fs = require("fs");
const path = require("path");
const simpleGit = require("simple-git");
const marked = require("marked");
require('dotenv').config()

const REPO_URL = "https://github.com/smfonseca/monorepo-changesets-demo";
const REPO_DIR = "./repo";
const OUTPUT_DIR = "./output";
const LATEST_VERSIONS = process.env.LATEST_VERSIONS;

if (!fs.existsSync(REPO_DIR)) fs.mkdirSync(REPO_DIR);
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);

let lastVersions = {};
console.log('LATEST VERSIONS =>', LATEST_VERSIONS)
if (LATEST_VERSIONS) {
  try {
    lastVersions = JSON.parse(LATEST_VERSIONS);
  } catch (error) {
    console.error("Failed to parse LATEST_VERSIONS", error.message);
  }
}

(async function main() {
  try {
    const git = simpleGit();
    if (!fs.existsSync(path.join(REPO_DIR, ".git"))) {
      await git.clone(REPO_URL, REPO_DIR);
    } else {
      await git.cwd(REPO_DIR).pull();
    }

    const packagesDir = path.join(REPO_DIR, "packages");
    const packages = fs.readdirSync(packagesDir);

    let teamsHtml = "<html><body>";
    let universumHtml = "<html><body><h2>Development</h2>";
    let hasChanges = false;

    for (const pkg of packages) {
      const changelogPath = path.join(packagesDir, pkg, "CHANGELOG.md");

      if (!fs.existsSync(changelogPath)) {
        console.log(`No changelog found for package ${pkg}. Skipping.`);
        continue;
      }

      const changelog = fs.readFileSync(changelogPath, "utf-8");
      const latestChanges = extractChanges(changelog, lastVersions[pkg]);

      if (latestChanges && latestChanges.trim()) {
        hasChanges = true;
        let htmlContent = marked.parse(latestChanges);

        // Combine consecutive headers: <h2>Version</h2><h3>Next Header</h3> -> <h3>Version Next Header</h3>
        htmlContent = htmlContent.replace(
          /<h2>(.*?)<\/h2>\s*<h3>(.*?)<\/h3>/g,
          "<h3>$1 $2</h3>"
        );

        // For teams file
        teamsHtml += `<h2>${pkg} package</h2>${htmlContent}<br />`;

        // For universum file
        let transformedContent = htmlContent
          .replace(/<h2>/g, "<h3>") // Package name becomes h3
          .replace(/<h3>(.*?)Stats<\/h3>/g, "<h5>$1Stats</h5>") // Stats becomes h5
          .replace(/<h3>/g, "<h4>"); // Version becomes h4

        universumHtml += `<h3>${pkg} package</h3>${transformedContent}<br />`;

        console.log(`Included changelog for package: ${pkg}`);

        // Update the latest version of each package
        const latestVersion = extractLatestVersion(changelog);
        if (latestVersion) {
          lastVersions[pkg] = latestVersion;
        }
      } else {
        console.log(`No new changes for package: ${pkg}. Skipping.`);
      }
    }

    if (hasChanges) {
      // Finalize HTML content
      universumHtml += "<h2>Design</h2></body></html>";
      teamsHtml += "</body></html>";

      // Save the HTML files
      fs.writeFileSync(path.join(OUTPUT_DIR, "output_teams.html"), teamsHtml, "utf-8");
      fs.writeFileSync(path.join(OUTPUT_DIR, "output_universum.html"), universumHtml, "utf-8");

      console.log(`Changelogs saved to ${OUTPUT_DIR}`);
    } else {
      console.log("No changes found in any package. Skipping file creation.");
    }

    // Output updated latest_versions and has_changes for GitHub Actions
    console.log("::set-output name=has_changes::" + hasChanges.toString());
    if (hasChanges) {
      console.log("::set-output name=latest_versions::" + `'${JSON.stringify(lastVersions)}'`);
    }

    // Cleanup: Delete the repo directory
    if (fs.existsSync(REPO_DIR)) {
      fs.rmSync(REPO_DIR, { recursive: true, force: true });
      console.log("Repo folder deleted successfully.");
    }
  } catch (error) {
    console.error("An error occurred:", error);
  }
})();

/**
 * Extract changes from the changelog since the last version.
 */
function extractChanges(changelog, lastVersion) {
  const sections = changelog.split(/\n(?=##\s+)/);

  const validSections = sections.filter((section) => {
    const firstLine = section.trim().split("\n")[0];
    return !firstLine.startsWith("# [@solid-design-system/");
  });

  let resultSections = [];
  let reachedLastVersion = false;

  for (let section of validSections) {
    const versionMatch = section.match(/^##\s*([\d.]+(?:-[\w.]+)?)/);
    if (versionMatch) {
      const version = versionMatch[1];
      if (version === lastVersion) {
        reachedLastVersion = true;
        break;
      }
    }

    const lines = section.trim().split("\n").slice(1);
    const hasContent = lines.some((line) => line.trim() !== "");
    if (hasContent) {
      resultSections.push(section);
    }
  }

  return reachedLastVersion ? resultSections.join("\n\n").trim() : "";
}

/**
 * Extract the latest version from the changelog.
 */
function extractLatestVersion(changelog) {
  const match = changelog.match(/^##\s*([\d.]+(?:-[\w.]+)?)/m);
  return match ? match[1] : null;
}
