mod lexer;

use lexer::Token;
use logos::Logos;

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

    println!("Input:\n{input}");
    println!("Tokens:");
    println!("{:-<40}", "");

    let lexer = Token::lexer(input);

    for (token, span) in lexer.spanned() {
        match token {
            Ok(tok) => println!("{:<30} {:?}", tok.to_string(), &input[span]),
            Err(()) => println!("{:<30} {:?}", "ERROR", &input[span]),
        }
    }
}
