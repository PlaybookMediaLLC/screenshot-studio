const {setTimeout: delay} = require('node:timers/promises');

// Setup runs beside the build. Artifacts are scoped to this run and exact SHA;
// a failed-jobs-only rerun may reuse the successful earlier attempt's image.
async function waitForImage({github, context, core, sleep = delay}) {
  const run = {...context.repo, run_id: context.runId, per_page: 100};
  const prefix = `ci-web-${context.sha}-`;
  let completedBuild;
  for (let attempt = 0; attempt < 120; attempt++) {
    const artifacts = await github.paginate(github.rest.actions.listWorkflowRunArtifacts, run);
    const image = artifacts
      .filter(artifact => !artifact.expired && artifact.name.startsWith(prefix))
      .sort((a, b) => b.id - a.id)[0];
    if (image) {
      core.setOutput('name', image.name);
      return;
    }
    if (completedBuild) {
      throw new Error(`Web image build ended as ${completedBuild.conclusion} without an available image artifact.`);
    }
    const jobs = await github.paginate(github.rest.actions.listJobsForWorkflowRun, {...run, filter: 'latest'});
    const build = jobs.find(job => job.name === 'Build web image');
    if (build?.status === 'completed') {
      // Upload can finish between the artifact and job queries; read artifacts again.
      completedBuild = build;
      continue;
    }
    await sleep(10_000);
  }
  throw new Error('Timed out after 20 minutes waiting for the web image artifact.');
}

module.exports = {waitForImage};
