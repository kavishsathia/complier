//! Tool/namespace name normalization. Mirrors the Python `local_mcp` helpers
//! so internal identities are stable across Python and Rust wrappers.

/// Returns the internal wrapper identity for a downstream MCP tool,
/// e.g. `"search" + "web_search"` → `"search.web_search"`.
pub fn normalize_tool_name(namespace: &str, tool_name: &str) -> Result<String, String> {
    let ns = normalize_machine_name(namespace);
    if ns.is_empty() {
        return Err("Namespace must contain at least one letter or digit.".into());
    }
    let tool = normalize_machine_name(tool_name);
    if tool.is_empty() {
        return Err("Tool name must contain at least one letter or digit.".into());
    }
    Ok(format!("{ns}.{tool}"))
}

/// Public tool name exposed to the agent (no namespace).
pub fn public_tool_name(tool_name: &str) -> Result<String, String> {
    let tool = normalize_machine_name(tool_name);
    if tool.is_empty() {
        return Err("Tool name must contain at least one letter or digit.".into());
    }
    Ok(tool)
}

fn normalize_machine_name(value: &str) -> String {
    let lowered = value.trim().to_ascii_lowercase().replace('\'', "");
    let mut out = String::with_capacity(lowered.len());
    let mut last_was_underscore = false;
    for ch in lowered.chars() {
        let keep = ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '/' | '-');
        if keep {
            out.push(ch);
            last_was_underscore = ch == '_';
        } else if !last_was_underscore {
            out.push('_');
            last_was_underscore = true;
        }
    }
    out.trim_matches(|c: char| matches!(c, '.' | '_' | '/' | '-'))
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_namespace_and_tool() {
        assert_eq!(
            normalize_tool_name("Search API", "Web Search!").unwrap(),
            "search_api.web_search"
        );
    }

    #[test]
    fn rejects_empty() {
        assert!(normalize_tool_name("   ", "x").is_err());
        assert!(public_tool_name("!!!").is_err());
    }
}
