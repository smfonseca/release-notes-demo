const fs = require("fs");
const path = require("path");
const simpleGit = require("simple-git");
const marked = require("marked");

const REPO_URL = "https://github.com/solid-design-system/solid";
const REPO_DIR = "./repo";
const OUTPUT_DIR = "./output";
const LATEST_VERSIONS = process.env.LATEST_VERSIONS;

if (!fs.existsSync(REPO_DIR)) fs.mkdirSync(REPO_DIR);
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);

let lastVersions = {};
if (LATEST_VERSIONS) {
  try {
    lastVersions = JSON.parse(LATEST_VERSIONS);
  } catch (error) {
    console.error("Failed to parse LATEST_VERSIONS. Using an empty object.");
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

    for (const pkg of packages) {
      const changelogPath = path.join(packagesDir, pkg, "CHANGELOG.md");

      if (!fs.existsSync(changelogPath)) {
        console.log(`No changelog found for package ${pkg}. Skipping.`);
        continue;
      }

      const changelog = fs.readFileSync(changelogPath, "utf-8");
      const latestChanges = extractChanges(changelog, lastVersions[pkg]);

      if (latestChanges && latestChanges.trim()) {
        let htmlContent = marked.parse(latestChanges);

        // we combine consecutive headers => <h2>Version</h2><h3>Next Header</h3> -> <h2>Version Next Header</h2>
        htmlContent = htmlContent.replace(
          /<h2>(.*?)<\/h2>\s*<h3>(.*?)<\/h3>/g,
          "<h3>$1 $2</h3>"
        );

        // teams only supports h1 to h3 headers, we can keep original structure
        teamsHtml += `<h2>${pkg} package</h2>${htmlContent}<br />`;

        // universum headers can go from h1 to h6 and needs to be adjusted
        let transformedContent = htmlContent
          .replace(/<h2>/g, "<h3>") // package name becomes h3
          .replace(/<h3>(.*?)Stats<\/h3>/g, "<h5>$1Stats</h5>") // stats becomes h5
          .replace(/<h3>/g, "<h4>"); // version becomes h4

        universumHtml += `<h3>${pkg} package</h3>${transformedContent}<br />`;

        console.log(`Included changelog for package: ${pkg}`);

        // update latest version of each package
        const latestVersion = extractLatestVersion(changelog);
        if (latestVersion) {
          lastVersions[pkg] = latestVersion;
        }
      } else {
        console.log(`No new changes for package: ${pkg}. Skipping.`);
      }
    }

    // for universum we include the starting header for the design part
    universumHtml += "<h2>Design</h2></body></html>";

    // for teams no further information is required
    teamsHtml += "</body></html>";

    fs.writeFileSync(path.join(OUTPUT_DIR, "output_teams.html"), teamsHtml, "utf-8");
    fs.writeFileSync(path.join(OUTPUT_DIR, "output_universum.html"), universumHtml, "utf-8");

    console.log(`Changelogs saved to ${OUTPUT_DIR}`);

    if (fs.existsSync(REPO_DIR)) {
      fs.rmSync(REPO_DIR, { recursive: true, force: true });
      console.log("Repo folder deleted successfully.");
    }

    console.log("::set-output name=latest_versions::" + JSON.stringify(lastVersions));
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
  for (let section of validSections) {
    if (lastVersion && section.includes(`## ${lastVersion}`)) {
      break;
    }

    const lines = section.trim().split("\n").slice(1);
    const hasContent = lines.some((line) => line.trim() !== "");
    if (hasContent) {
      resultSections.push(section);
    }
  }

  return resultSections.join("\n\n").trim();
}

/**
 * Extract the latest version from the changelog.
 */
function extractLatestVersion(changelog) {
  // versions from changesets are always an h2
  const match = changelog.match(/^##\s*([\d.]+)/m);
  return match ? match[1] : null;
}
