"""Demo: run a Complier-enforced research workflow with Gemma 4 E4B."""

from pathlib import Path

from mlx_lm import load, generate as mlx_generate

from complier.contract.model import Contract


# --- load model ---------------------------------------------------------------

print("Loading model...")
_model, _tokenizer = load("mlx-community/gemma-4-E4B-it-4bit")


class _Model:
    """Thin wrapper so agent.run() gets a single callable object."""
    def generate(self, prompt: str, max_tokens: int = 1024) -> str:
        return mlx_generate(_model, _tokenizer, prompt=prompt, max_tokens=max_tokens, verbose=False)


# --- tool implementations -----------------------------------------------------

def search_web(query: str = "") -> str:
    print(f"  [tool] search_web(query={query!r})")
    return (
        f"Search results for '{query}': "
        "1. Example article about the topic with key findings. "
        "2. Another relevant source with supporting data."
    )


def summarize(content: str = "") -> str:
    print(f"  [tool] summarize(content={content!r})")
    return f"Summary: The research on '{content}' shows promising results with clear conclusions."


def save_note(note: str = "") -> str:
    print(f"  [tool] save_note(note={note!r})")
    return "Note saved successfully."


tools = {
    "search_web": search_web,
    "summarize": summarize,
    "save_note": save_note,
}

# --- load contract and run ----------------------------------------------------

contract = Contract.from_file(Path(__file__).parent / "demo.cpl")
session = contract.create_session(workflow="research")

from harness.agent import run

history = run(
    session=session,
    tools=tools,
    model=_Model(),
    tokenizer=_tokenizer,
    task="Research the latest developments in small language models for edge devices.",
    verbose=True,
)

print("\n--- done ---")
