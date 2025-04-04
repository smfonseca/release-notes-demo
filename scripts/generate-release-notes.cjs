const fs = require("fs");
const path = require("path");
const simpleGit = require("simple-git");
const marked = require("marked");
require("dotenv").config();

const REPO_URL = "https://github.com/solid-design-system/solid";
const REPO_DIR = "./repo";
const OUTPUT_DIR = "./output";
const LATEST_VERSIONS = process.env.LATEST_VERSIONS;
const GITHUB_OUTPUT = process.env.GITHUB_OUTPUT;

let lastVersions = {};

const initializeDirectories = () => {
  if (!fs.existsSync(REPO_DIR)) fs.mkdirSync(REPO_DIR);
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);
}

const loadLatestVersions = () => {
  if (LATEST_VERSIONS) {
    try {
      const versions = LATEST_VERSIONS.split(",");
      versions.forEach((entry) => {
        const [pkg, version] = entry.split(":");
        if (pkg && version) lastVersions[pkg.trim()] = version.trim();
      });
    } catch (error) {
      console.error("Failed to parse LATEST_VERSIONS", error.message);
    }
  }
}

const cloneRepository = async (repoUrl, repoDir) => {
  const git = simpleGit();
  if (!fs.existsSync(path.join(repoDir, ".git"))) {
    await git.clone(repoUrl, repoDir);
    console.log("Repository cloned successfully.");
  } else {
    await git.cwd(repoDir).pull();
    console.log("Repository updated successfully.");
  }
}

const getPackages = (packagesDir) => {
  return fs.readdirSync(packagesDir);
}

const initializePackageVersions = (packages, packagesDir) => {
  packages.forEach((pkg) => {
    if (lastVersions[pkg]) {
      return;
    }

    const changelogPath = path.join(packagesDir, pkg, "CHANGELOG.md");
    if (!fs.existsSync(changelogPath)) {
      console.log(`No changelog found for package ${pkg}. Skipping.`);
      lastVersions[pkg] = null;
      return;
    }

    const changelog = fs.readFileSync(changelogPath, "utf-8");
    const firstVersion = extractLatestVersion(changelog);

    if (!firstVersion) {
      console.log(`No version found in changelog for package ${pkg}. Skipping.`);
      lastVersions[pkg] = null;
      return;
    }

    lastVersions[pkg] = firstVersion;
  });
};


const prepareOutputFiles = (packages, packagesDir) => {
  let teamsHtml = "<html><body>";
  let hasChanges = false;

  packages.forEach((pkg) => {
    const changelogPath = path.join(packagesDir, pkg, "CHANGELOG.md");

    if (!fs.existsSync(changelogPath)) {
      console.log(`No changelog found for package ${pkg}. Skipping.`);
      return;
    }

    const changelog = fs.readFileSync(changelogPath, "utf-8");
    const latestChanges = extractChanges(changelog, lastVersions[pkg]);

    if (!latestChanges?.trim()) {
      console.log(`No new changes for package: ${pkg}. Skipping.`);
      return;
    }

    hasChanges = true;
    let htmlContent = marked.parse(latestChanges);
    const pkgName = capitalize(pkg);

    htmlContent = htmlContent.replace(/<h2>(.*?)<\/h2>\s*<h3>(.*?)<\/h3>/g, "<h3>$1 $2</h3>");

    teamsHtml += `<h2>${pkgName} Package</h2>${htmlContent}<br />`;

    console.log(`Included changelog for package: ${pkgName}`);

    const latestVersion = extractLatestVersion(changelog);
    if (latestVersion) {
      lastVersions[pkg] = latestVersion;
    }
  });

  teamsHtml += "</body></html>";

  return { teamsHtml, hasChanges };
}

const saveOutputFiles = (teamsHtml, hasChanges) => {
  if (hasChanges) {
    fs.writeFileSync(path.join(OUTPUT_DIR, "output_teams.html"), teamsHtml, "utf-8");
    console.log(`Changelogs saved to ${OUTPUT_DIR}`);
  } else {
    console.log("No changes found in any package. Skipping file creation.");
  }
}

const setGitHubActionsOutputs = (hasChanges, lastVersions) => {
  if (!GITHUB_OUTPUT) {
    console.error('GITHUB_OUTPUT environment variable is not set.');
    return;
  }

  fs.appendFileSync(GITHUB_OUTPUT, `has_changes=${hasChanges.toString()}\n`);

  if (hasChanges) {
    const latestVersionsString = Object.entries(lastVersions)
    .map(([pkg, version]) => `${pkg}:${version}`)
    .join(",");

    fs.appendFileSync(GITHUB_OUTPUT, `latest_versions=${latestVersionsString}\n`);
  }
}

const cleanup = (repoDir) => {
  if (fs.existsSync(repoDir)) {
    fs.rmSync(repoDir, { recursive: true, force: true });
    console.log("Repo folder deleted successfully.");
  }
}

const extractChanges = (changelog, lastVersion) => {
  // split into sections starting with ## headings
  const sections = changelog.split(/\n(?=##\s+)/);

  // filter sections to exclude the top-level <h1> and invalid sections
  const validSections = sections.filter((section, index) => {
    // exclude the first section if it starts with a single #
    if (index === 0 && section.startsWith("# ")) {
      return false;
    }

    const firstLine = section.trim().split("\n")[0];
    return !firstLine.startsWith("# [@solid-design-system/"); // filter for specific pattern
  });

  let resultSections = [];
  let reachedLastVersion = false;

  for (let section of validSections) {
    // check if the section is a version heading
    const versionMatch = section.match(/^##\s*([\d.]+(?:-[\w.]+)?)/);
    if (versionMatch) {
      const version = versionMatch[1];
      if (version === lastVersion) {
        reachedLastVersion = true;
        break;
      }
    }

    // exclude section heading
    const lines = section.trim().split("\n").slice(1);
    const hasContent = lines.some((line) => line.trim() !== "");
    if (hasContent) {
      resultSections.push(section);
    }
  }

  return reachedLastVersion ? resultSections.join("\n\n").trim() : "";
}

const extractLatestVersion = (changelog) => {
  const match = changelog.match(/^##\s*([\d.]+(?:-[\w.]+)?)/m);
  return match ? match[1] : null;
}

const capitalize = (str) => {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

(async () => {
  try {
    initializeDirectories();
    loadLatestVersions();

    await cloneRepository(REPO_URL, REPO_DIR);
    const packagesDir = path.join(REPO_DIR, "packages");
    const packages = getPackages(packagesDir);

    initializePackageVersions(packages, packagesDir);

    const { teamsHtml, hasChanges } = prepareOutputFiles(packages, packagesDir);

    saveOutputFiles(teamsHtml, hasChanges);
    setGitHubActionsOutputs(hasChanges, lastVersions);

    cleanup(REPO_DIR);
  } catch (error) {
    console.error("An error occurred:", error);
  }
})();
