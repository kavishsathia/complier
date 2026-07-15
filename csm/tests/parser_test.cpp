#include "complier/error.hpp"
#include "complier/parser.hpp"
#include "testing.hpp"

#include <variant>

using namespace complier;

TEST(parses_guarantees) {
    auto prog = parse(
        "guarantee clean `env.deploys == 0`\n"
        "guarantee reviewed [the diff was reviewed]:halt\n"
        "guarantee approved {ops signed off}:5\n");
    CHECK_EQ(prog.items.size(), 3u);

    const auto& clean = std::get<ast::Guarantee>(prog.items[0]);
    CHECK_EQ(clean.name, "clean");
    CHECK(clean.expression.kind == ast::Constraint::Kind::Cel);
    CHECK_EQ(clean.expression.text, "env.deploys == 0");
    CHECK(clean.expression.policy.kind == ast::Policy::Kind::Retry);
    CHECK_EQ(clean.expression.policy.attempts, 3);

    const auto& reviewed = std::get<ast::Guarantee>(prog.items[1]);
    CHECK(reviewed.expression.kind == ast::Constraint::Kind::Model);
    CHECK(reviewed.expression.policy.kind == ast::Policy::Kind::Halt);

    const auto& approved = std::get<ast::Guarantee>(prog.items[2]);
    CHECK(approved.expression.kind == ast::Constraint::Kind::Human);
    CHECK(approved.expression.policy.kind == ast::Policy::Kind::Retry);
    CHECK_EQ(approved.expression.policy.attempts, 5);
}

TEST(parses_workflow_attrs_and_inline_steps) {
    auto prog = parse(
        "guarantee clean `ok`\n"
        "workflow \"release\" @always clean @ambient read_file grep\n"
        "    | @llm \"summarize the diff\"\n"
        "    | @human \"take a look\"\n"
        "    | @call publish\n"
        "    | @fork f1 @use notify\n"
        "    | @join f1\n");
    const auto& wf = std::get<ast::Workflow>(prog.items[1]);
    CHECK_EQ(wf.name, "release");
    CHECK_EQ(wf.always, (std::vector<std::string>{"clean"}));
    CHECK_EQ(wf.ambient, (std::vector<std::string>{"read_file", "grep"}));
    CHECK_EQ(wf.steps.size(), 5u);

    CHECK_EQ(std::get<ast::LlmStep>(wf.steps[0].value).prompt, "summarize the diff");
    CHECK_EQ(std::get<ast::HumanStep>(wf.steps[1].value).prompt, "take a look");

    const auto& call = std::get<ast::SubworkflowStep>(wf.steps[2].value);
    CHECK(call.call_type == ast::CallType::Call);
    CHECK_EQ(call.workflow_name, "publish");

    const auto& fork = std::get<ast::ForkStep>(wf.steps[3].value);
    CHECK_EQ(fork.fork_id, "f1");
    CHECK(fork.target.call_type == ast::CallType::Use);
    CHECK_EQ(fork.target.workflow_name, "notify");

    CHECK_EQ(std::get<ast::JoinStep>(wf.steps[4].value).fork_id, "f1");
}

TEST(parses_tool_steps_with_every_param_form) {
    auto prog = parse(
        "workflow \"w\"\n"
        "    | run_tests suite=\"unit\" retries=3 verbose=true dry=false tag=null\n"
        "    | deploy note=(be gentle) check=[looks good]:skip sign={ops approve}:halt gate=`n < 2`:2\n");
    const auto& wf = std::get<ast::Workflow>(prog.items[0]);

    const auto& run = std::get<ast::ToolStep>(wf.steps[0].value);
    CHECK_EQ(run.name, "run_tests");
    CHECK_EQ(run.params.size(), 5u);
    CHECK_EQ(std::get<std::string>(run.params[0].value), "unit");
    CHECK_EQ(std::get<std::int64_t>(run.params[1].value), 3);
    CHECK_EQ(std::get<bool>(run.params[2].value), true);
    CHECK_EQ(std::get<bool>(run.params[3].value), false);
    CHECK(std::holds_alternative<std::monostate>(run.params[4].value));

    const auto& deploy = std::get<ast::ToolStep>(wf.steps[1].value);
    const auto& note = std::get<ast::Constraint>(deploy.params[0].value);
    CHECK(note.kind == ast::Constraint::Kind::Hint);
    CHECK_EQ(note.text, "be gentle");
    const auto& check = std::get<ast::Constraint>(deploy.params[1].value);
    CHECK(check.kind == ast::Constraint::Kind::Model);
    CHECK(check.policy.kind == ast::Policy::Kind::Skip);
    const auto& sign = std::get<ast::Constraint>(deploy.params[2].value);
    CHECK(sign.kind == ast::Constraint::Kind::Human);
    CHECK(sign.policy.kind == ast::Policy::Kind::Halt);
    const auto& gate = std::get<ast::Constraint>(deploy.params[3].value);
    CHECK(gate.kind == ast::Constraint::Kind::Cel);
    CHECK(gate.policy.kind == ast::Policy::Kind::Retry);
    CHECK_EQ(gate.policy.attempts, 2);
}

TEST(parses_branch_blocks) {
    auto prog = parse(
        "workflow \"w\"\n"
        "    | @branch\n"
        "        -when \"tests pass\"\n"
        "            | @call publish\n"
        "        -when \"tests flaky\"\n"
        "            | rerun\n"
        "        -else\n"
        "            | @human \"triage the failure\"\n");
    const auto& wf = std::get<ast::Workflow>(prog.items[0]);
    const auto& branch = std::get<ast::BranchStep>(wf.steps[0].value);
    CHECK_EQ(branch.when_arms.size(), 2u);
    CHECK_EQ(branch.when_arms[0].condition, "tests pass");
    CHECK_EQ(branch.when_arms[1].steps.size(), 1u);
    CHECK(branch.else_arm.has_value());
    CHECK_EQ(branch.else_arm->steps.size(), 1u);
}

TEST(parses_loop_and_unordered_blocks) {
    auto prog = parse(
        "workflow \"w\"\n"
        "    | @loop\n"
        "        | poll_status\n"
        "        -until \"status is green\"\n"
        "    | @unordered\n"
        "        -step \"docs\"\n"
        "            | update_docs\n"
        "        -step \"tests\"\n"
        "            | run_tests\n");
    const auto& wf = std::get<ast::Workflow>(prog.items[0]);

    const auto& loop = std::get<ast::LoopStep>(wf.steps[0].value);
    CHECK_EQ(loop.steps.size(), 1u);
    CHECK_EQ(loop.until, "status is green");

    const auto& unordered = std::get<ast::UnorderedStep>(wf.steps[1].value);
    CHECK_EQ(unordered.cases.size(), 2u);
    CHECK_EQ(unordered.cases[0].label, "docs");
    CHECK_EQ(unordered.cases[1].label, "tests");
}

TEST(keywords_still_work_as_names) {
    auto prog = parse(
        "workflow \"w\"\n"
        "    | halt true=1\n");
    const auto& tool = std::get<ast::ToolStep>(std::get<ast::Workflow>(prog.items[0]).steps[0].value);
    CHECK_EQ(tool.name, "halt");
    CHECK_EQ(tool.params[0].name, "true");
}

TEST(rejects_malformed_contracts) {
    CHECK_THROWS(parse(""));
    CHECK_THROWS(parse("   \n\n"));
    CHECK_THROWS(parse("workflow \"w\"\n"));                          // no steps
    CHECK_THROWS(parse("workflow w\n    | a\n"));                     // unquoted name
    CHECK_THROWS(parse("guarantee g (just a hint)\n"));               // hint is not verifiable
    CHECK_THROWS(parse("workflow \"w\"\n    | @branch\n        -else\n            | a\n"));  // else without when
    CHECK_THROWS(parse("workflow \"w\"\n    | @loop\n        | a\n"));  // loop without until
    CHECK_THROWS(parse("workflow \"w\"\n    | @fork f1 publish\n"));    // fork needs @call/@use/@inline
    CHECK_THROWS(parse("workflow \"w\" @ambient\n    | a\n"));          // ambient needs tools
}
