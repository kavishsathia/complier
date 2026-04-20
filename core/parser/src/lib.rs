mod lexer;
mod parse;

pub use parse::{parse, ParseError};

#[cfg(test)]
mod tests {
    use crate::parse;
    use ast::{Item, Step};

    const DEMO: &str = r#"
guarantee safe 'no harmful content {safe}'

workflow "research"
    @always safe
    | search_web query='focused and specific [query_focused]'
    | summarize content='clear and concise [summary_clear]'
    | save_note
"#;

    #[test]
    fn parses_demo_contract() {
        let program = parse(DEMO).expect("parse failed");
        assert_eq!(program.items.len(), 2);

        let Item::Workflow(wf) = &program.items[1] else {
            panic!("expected workflow");
        };
        assert_eq!(wf.name, "research");
        assert_eq!(wf.always, vec!["safe"]);
        assert_eq!(wf.steps.len(), 3);

        let Step::Tool(t) = &wf.steps[0] else { panic!() };
        assert_eq!(t.name, "search_web");
        assert_eq!(t.params.len(), 1);
    }
}
