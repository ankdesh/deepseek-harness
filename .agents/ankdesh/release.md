# ankdesh-dsh releases

The public fork owns the package recipe and release scripts. The private ankdesh-dsh-release repository owns execution and retained release artifacts.

## Set up the release repository

Install private-release-workflow.yml from this directory as .github/workflows/package-release.yml on the private repository's main branch. Configure the package-release environment and add OPENAI_API_KEY to the private repository's Actions secrets for consumer verification. Check the existing npm package visibility and give the private release repository write access to those packages. Grant read access to authorized consumer repositories and keep untrusted pull requests outside the credentialed install jobs.

## Run a release

Use the next unused ankdesh.N suffix. Dispatch the private workflow on main with a full ankdesh-dsh commit and a full spec2gds commit. The publish input defaults to false. Set it to true when you want the workflow to verify and publish the same archives. If publishing stops partway, rerun the failed publish job in the same workflow run to reuse its verified archives. If an existing version has different bytes, choose a fresh suffix and verify again.

Install from GitHub Packages with an authenticated @ankdesh scope mapping. Commit exact package versions and a lockfile in each product. Select a named dsh profile with an isolated DSH_HOME. To roll back, restore the previous manifest and lockfile and check Session data compatibility before opening existing state.
