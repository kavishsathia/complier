mod ast;
mod lexer;
mod parser;

use parser::Parser;

fn main() {
    let input = r#"
guarantee safe [no_harmful_content:halt]

workflow "research" @always safe
    | @human "What topic?"
    | search_web
    | @llm "Summarize" ([relevant:3] && [concise:halt])
    | @llm "Classify as technical or general"
    | @branch
        -when "technical"
            | @llm "Write detailed analysis"
            | @loop
                | @human "Is this good enough?"
                -until "yes"
            -end
        -when "general"
            | @llm "Write brief summary"
        -else
            | @llm "Write overview"
    -end
    | @unordered
        -step format_citations
        -step generate_bibliography
    -end
    | @fork refs @call check_references
    | @fork refs @call verify_sources
    | @join refs
    | @llm "Final review" (![needs_revision] && {approved:skip})
    | @call send_report
    | email to="user"
"#;

    let mut parser = Parser::new(input);
    match parser.parse_program() {
        Ok(program) => println!("{:#?}", program),
        Err(e) => eprintln!("{}", e),
    }
}
