mod lexer;

use lexer::Token;
use logos::Logos;

fn main() {
    let input = r#"
workflow "research"
    @human "What topic?" => topic
    | search_web query=topic => results
    | @llm "Summarize" => summary [relevant & concise]
    | email to="user" body=summary
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
