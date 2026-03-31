mod ast;
mod lexer;
mod parser;

use parser::Parser;

fn main() {
    let input = r#"
workflow "research"
    @human "What topic?"
    | search_web
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
    -end
    | email to="user"
"#;

    let parser = Parser::new(input);

    println!("Parser created with {} tokens", parser.tokens().len());
    for (tok, span) in parser.tokens() {
        println!("{:<30} {:?}", tok.to_string(), span);
    }
}
