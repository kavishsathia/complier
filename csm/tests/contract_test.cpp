#include "complier/contract.hpp"
#include "complier/error.hpp"
#include "testing.hpp"

#include <variant>

using namespace complier;

TEST(compiles_a_realistic_contract_end_to_end) {
    auto contract = Contract::from_source(
        "guarantee no_direct_deploys `env.deploys == 0`\n"
        "guarantee reviewed [the change was reviewed]:halt\n"
        "\n"
        "workflow \"release\" @always no_direct_deploys @ambient read_file grep\n"
        "    | @llm \"summarize the diff\"\n"
        "    | run_tests suite=\"unit\" retries=3\n"
        "    | @branch\n"
        "        -when \"tests pass\"\n"
        "            | @call publish\n"
        "        -else\n"
        "            | @human \"triage the failure\"\n"
        "    | @loop\n"
        "        | poll_status\n"
        "        -until \"status is green\"\n"
        "    | @fork f1 @use notify\n"
        "    | @join f1\n"
        "\n"
        "workflow \"publish\"\n"
        "    | deploy gate={ops approve}:halt\n"
        "\n"
        "workflow \"notify\"\n"
        "    | send_message channel=\"releases\"\n");

    CHECK_EQ(contract.workflows.size(), 3u);
    CHECK_EQ(contract.guarantees.size(), 2u);
    CHECK(contract.guarantees.at("reviewed").policy.kind == ast::Policy::Kind::Halt);

    const auto& release = contract.workflows.at("release");
    CHECK(release.ambient == (std::set<std::string>{"grep", "read_file"}));

    // every executable node in "release" inherits the @always guard
    int guarded = 0;
    for (const auto& [id, node] : release.nodes) {
        if (node.guards.empty()) continue;
        guarded++;
        CHECK_EQ(node.guards[0].text, "env.deploys == 0");
    }
    CHECK_EQ(guarded, 7);  // llm, run_tests, call, human, poll_status, fork, join

    // walking from start always reaches end
    const auto& start = release.nodes.at(release.start_node_id);
    CHECK_EQ(start.next_ids.size(), 1u);
    CHECK(release.nodes.at(release.end_node_id).next_ids.empty());
}

TEST(from_source_rejects_bad_contracts) {
    CHECK_THROWS(Contract::from_source(""));
    CHECK_THROWS(Contract::from_source("workflow \"w\"\n    | @llm\n"));
    CHECK_THROWS(Contract::from_source("workflow \"w\" @always ghost\n    | a\n"));
}

TEST(keeps_the_source_around) {
    const char* source = "workflow \"w\"\n    | a\n";
    auto contract = Contract::from_source(source);
    CHECK_EQ(contract.source, source);
    CHECK_EQ(contract.name, "anonymous");
}
