"""Multi-session registry keyed by caller-supplied session_name."""

from __future__ import annotations

from dataclasses import dataclass

from complier.contract.model import Contract
from complier.session.session import Session


@dataclass(slots=True)
class SessionEntry:
    name: str
    contract_path: str
    workflow: str | None
    session: Session
    pending_choice: str | None = None


class SessionRegistry:
    """Owns the Session instances the daemon is serving."""

    def __init__(self) -> None:
        self._by_name: dict[str, SessionEntry] = {}

    def attach(
        self,
        name: str,
        contract_path: str,
        workflow: str | None = None,
    ) -> SessionEntry:
        """Idempotent: return the existing entry if `name` is already attached."""
        existing = self._by_name.get(name)
        if existing is not None:
            return existing

        contract = Contract.from_file(contract_path)
        if workflow is None and len(contract.workflows) == 1:
            workflow = next(iter(contract.workflows))
        session = Session(contract=contract, workflow=workflow)
        entry = SessionEntry(
            name=name,
            contract_path=str(contract_path),
            workflow=workflow,
            session=session,
        )
        self._by_name[name] = entry
        return entry

    def detach(self, name: str) -> bool:
        return self._by_name.pop(name, None) is not None

    def get(self, name: str) -> SessionEntry | None:
        return self._by_name.get(name)

    def all(self) -> list[SessionEntry]:
        return list(self._by_name.values())
