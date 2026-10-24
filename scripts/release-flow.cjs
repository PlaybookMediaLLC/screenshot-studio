const {readFileSync} = require('node:fs');

function versionParts(version) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw new Error('Release version must be a stable major.minor.patch version.');
  }
  const parts = version.split('.').map(Number);
  if (!parts.every(Number.isSafeInteger)) throw new Error('Release version is too large.');
  return parts;
}

function compareVersions(left, right) {
  const a = versionParts(left), b = versionParts(right);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return Math.sign(a[i] - b[i]);
  return 0;
}

function releaseNotes(changelog, version) {
  const lines = changelog.split('\n');
  const start = lines.findIndex(line => {
    const match = /^## (?:\[)?(\d+\.\d+\.\d+)(?:\]|(?=\s|$))/.exec(line);
    return match?.[1] === version;
  });
  if (start < 0) throw new Error(`CHANGELOG.md has no section for ${version}.`);
  const next = lines.findIndex((line, index) => index > start && /^## /.test(line));
  const notes = lines.slice(start + 1, next < 0 ? undefined : next).join('\n').trim();
  if (!notes) throw new Error(`CHANGELOG.md has no release notes for ${version}.`);
  return notes;
}

async function optional(call) {
  try { return (await call()).data; }
  catch (error) { if (error.status === 404) return null; throw error; }
}

async function tagCommit(github, repo, tag) {
  const ref = await optional(() => github.rest.git.getRef({...repo, ref: `tags/${tag}`}));
  if (!ref) return null;
  let object = ref.object;
  for (let depth = 0; object.type === 'tag' && depth < 5; depth++) {
    object = (await github.rest.git.getTag({...repo, tag_sha: object.sha})).data.object;
  }
  if (object.type !== 'commit') throw new Error(`Cannot resolve ${tag} to a commit.`);
  return object.sha;
}

async function included(github, repo, ancestor, head) {
  const {data} = await github.rest.repos.compareCommits({...repo, base: ancestor, head});
  return data.status === 'ahead' || data.status === 'identical';
}

async function markPreparedReleases(github, repo, releasedSha) {
  const issues = await github.paginate(github.rest.issues.listForRepo, {
    ...repo, state: 'closed', labels: 'autorelease: pending', per_page: 100,
  });
  for (const issue of issues) {
    if (!issue.pull_request) continue;
    const {data: pr} = await github.rest.pulls.get({...repo, pull_number: issue.number});
    if (!pr.merged_at || pr.base.ref !== 'develop' ||
        pr.head.repo?.full_name !== `${repo.owner}/${repo.repo}` ||
        !pr.head.ref.startsWith('release-please--branches--develop--') ||
        !await included(github, repo, pr.merge_commit_sha, releasedSha)) continue;
    // Add before removing pending: interrupted cleanup remains discoverable on retry.
    await github.rest.issues.addLabels({...repo, issue_number: issue.number, labels: ['autorelease: tagged']});
    try {
      await github.rest.issues.removeLabel({...repo, issue_number: issue.number, name: 'autorelease: pending'});
    } catch (error) { if (error.status !== 404) throw error; }
  }
}

async function publishPromotedRelease({github, context, core, version, changelog}) {
  if (context.ref !== 'refs/heads/main') throw new Error('Releases may only be published from main.');
  const repo = context.repo;
  version ??= JSON.parse(readFileSync('package.json', 'utf8')).version;
  versionParts(version);
  const {data: promotion} = await github.rest.repos.getCommit({...repo, ref: context.sha});
  const prs = await github.paginate(github.rest.repos.listPullRequestsAssociatedWithCommit, {
    ...repo, commit_sha: context.sha, per_page: 100,
  });
  if (!prs.some(pr => pr.merged_at && pr.merge_commit_sha === context.sha &&
      pr.base.ref === 'main' && pr.head.ref === 'develop' &&
      pr.head.repo?.full_name === `${repo.owner}/${repo.repo}`)) {
    throw new Error('Main commit must come from a merged develop -> main release PR.');
  }
  if (promotion.parents.length !== 2) throw new Error('Release PRs must use a merge commit, not squash or rebase.');
  // Pin the immutable parent that was promoted, never today's moving develop tip.
  const sourceSha = promotion.parents[1].sha;
  const {data: source} = await github.rest.repos.getCommit({...repo, ref: sourceSha});
  if (promotion.commit.tree.sha !== source.commit.tree.sha) {
    throw new Error('Main must contain exactly the reviewed develop tree; resolve conflicts on develop first.');
  }
  const tag = `v${version}`;
  const existing = await optional(() => github.rest.repos.getReleaseByTag({...repo, tag}));
  const taggedSha = await tagCommit(github, repo, tag);
  if (existing) {
    if (existing.draft || existing.prerelease || !taggedSha || !await included(github, repo, taggedSha, sourceSha)) {
      throw new Error(`Existing ${tag} is not a published ancestor of this promotion.`);
    }
    await markPreparedReleases(github, repo, taggedSha);
    core.info(`${tag} already exists; no tag or release was changed.`);
    return {created: false, tag, sha: taggedSha};
  }
  const latest = await optional(() => github.rest.repos.getLatestRelease(repo));
  if (latest && compareVersions(version, latest.tag_name.replace(/^v/, '')) <= 0) {
    throw new Error('A new release must have a version newer than the latest published release.');
  }
  if (taggedSha && taggedSha !== sourceSha) throw new Error(`${tag} already points to a different commit.`);
  changelog ??= readFileSync('CHANGELOG.md', 'utf8');
  await github.rest.repos.createRelease({
    ...repo, tag_name: tag, target_commitish: sourceSha, name: tag,
    body: releaseNotes(changelog, version), draft: false, prerelease: false, make_latest: 'true',
  });
  // Tag the promoted develop commit: identical bytes to main, reachable by
  // Release Please on develop, without including any later develop changes.
  await markPreparedReleases(github, repo, sourceSha);
  core.info(`Published ${tag} from promoted commit ${sourceSha}.`);
  return {created: true, tag, sha: sourceSha};
}

module.exports = {compareVersions, releaseNotes, publishPromotedRelease};
