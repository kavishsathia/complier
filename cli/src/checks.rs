// Checks: complier's own events. A spec that declares `datatype Check` names its checks, e.g.
//
//   datatype Dir = src
//   datatype Check = dafny.Dir
//
// and the policy starts one with check.dafny.src. The daemon performs it: it copies the workspace's
// `src` into a fresh snapshot and runs check dafny's command over it in dafny's container. The
// container's exit status is the verdict, pass.dafny.src (0) or fail.dafny.src (anything else), and
// the policy goes on from there. FDR proved the policy accepts either.
//
// Check `dafny` is the folder checks/dafny next to the spec: a Dockerfile, which says where the check
// runs (the image is built at machine up and kept for the machine's life), and check.yaml, which says
// how:
//
//   run: dafny verify $(find "$@" -name '*.dfy')
//
// The command runs under sh in /work, without network, and gets the check's parameters as its
// arguments: each the path of that file or folder of the workspace in the snapshot, mounted
// read-only (`/work/src`). A check is stateless: every run starts from the image and the snapshot,
// and keeps nothing.

use crate::yaml::{self, Doc};
use anyhow::{bail, Context, Result};
use std::path::{Path, PathBuf};
use std::process::Command;

// A check as the machine runs it: the image built from its Dockerfile, and its command.
#[derive(Clone, Debug)]
pub struct Package {
    pub dir: PathBuf,
    pub image: String,
    pub run: String,
}

// The check's name and its parameters, from a value of Check as FDR prints it: `dafny.src` is check
// dafny with the parameter src.
pub fn split(value: &str) -> (&str, Vec<&str>) {
    let mut parts = value.split('.');
    let name = parts.next().unwrap_or_default();
    (name, parts.collect())
}

// Where check `name` is for a spec: checks/<name> next to it.
pub fn folder(spec: &Path, name: &str) -> PathBuf {
    spec.parent().unwrap_or(Path::new(".")).join("checks").join(name)
}

// Loads check `name` and builds its image.
pub fn load(spec: &Path, name: &str) -> Result<Package> {
    let dir = folder(spec, name);
    let file = dir.join("check.yaml");
    let text = std::fs::read_to_string(&file).with_context(|| format!("check {name}: reading {}", file.display()))?;
    let shown = file.display().to_string();
    let doc = Doc { file: &shown };
    let root = yaml::parse(&file, &text)?;
    let fields = doc.fields(&root, "check", &["run"], &[])?;
    let run = doc.str(fields.req("run"), "run")?.to_string();
    if !dir.join("Dockerfile").is_file() {
        bail!("check {name}: no Dockerfile in {}; it says where the check runs", dir.display());
    }
    let image = build(&dir).with_context(|| format!("check {name}: building {}", dir.join("Dockerfile").display()))?;
    Ok(Package { dir, image, run })
}

// Builds the image and returns its id (sha256:...), which names exactly this build.
fn build(dir: &Path) -> Result<String> {
    let out = Command::new("docker").args(["build", "-q"]).arg(dir).output().context("running docker (is Docker running?)")?;
    if !out.status.success() {
        bail!("docker build failed: {}", String::from_utf8_lossy(&out.stderr).trim());
    }
    let id = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if !id.starts_with("sha256:") {
        bail!("docker build gave no image id: {id}");
    }
    Ok(id)
}

// What one run of a check came to.
pub struct Run {
    pub passed: bool,
    // What the command printed (stdout, then stderr), for the log.
    pub output: String,
}

// Runs a check once: snapshots its parameters from the workspace into `snapshot`, then runs the
// command over them in the check's image. Err if it couldn't run at all (no Docker, the command
// missing from the image): that isn't a verdict.
pub fn run(package: &Package, workspace: &Path, params: &[&str], snapshot: &Path) -> Result<Run> {
    std::fs::create_dir_all(snapshot)?;
    let mut args = Vec::new();
    let mut missing = Vec::new();
    for p in params {
        let from = workspace.join(p);
        if from.exists() {
            let status = Command::new("cp").arg("-R").arg(&from).arg(snapshot.join(p)).status().context("copying the check's inputs")?;
            if !status.success() {
                bail!("couldn't copy {} into the check's snapshot", from.display());
            }
        } else {
            missing.push(from.display().to_string());
        }
        args.push(format!("/work/{p}"));
    }
    // An input that isn't there fails the check: there's nothing to pass it.
    if !missing.is_empty() {
        return Ok(Run { passed: false, output: format!("not in the workspace: {}", missing.join(", ")) });
    }
    let out = Command::new("docker")
        .args(["run", "--rm", "--network", "none", "-w", "/work", "-v"])
        .arg(format!("{}:/work:ro", snapshot.display()))
        .arg(&package.image)
        .args(["sh", "-c", &package.run, "check"])
        .args(&args)
        .output()
        .context("running docker (is Docker running?)")?;
    let output = format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr));
    match out.status.code() {
        Some(0) => Ok(Run { passed: true, output }),
        // docker run's own failures, and a command the shell couldn't find or run.
        Some(125..=127) | None => bail!("the check couldn't run (exit {:?}): {}", out.status.code(), output.trim()),
        Some(_) => Ok(Run { passed: false, output }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_value_of_check_names_the_check_and_its_parameters() {
        assert_eq!(split("dafny.src"), ("dafny", vec!["src"]));
        assert_eq!(split("lint"), ("lint", vec![]));
        assert_eq!(split("compare.a.b"), ("compare", vec!["a", "b"]));
    }
}
