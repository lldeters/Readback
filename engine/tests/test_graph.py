"""The small graph constructors that later phases build on."""

from __future__ import annotations

import pytest

from hearback_engine import ENGINE_VERSION, graph


def test_position() -> None:
    assert graph.position(0, 0) == {"line": 0, "character": 0}
    assert graph.position(12, 7) == {"line": 12, "character": 7}


@pytest.mark.parametrize(("line", "character"), [(-1, 0), (0, -1)])
def test_positions_are_zero_based(line: int, character: int) -> None:
    with pytest.raises(ValueError, match="zero-based"):
        graph.position(line, character)


def test_text_range() -> None:
    start, end = graph.position(1, 4), graph.position(1, 9)
    assert graph.text_range("/w/a.py", start, end) == {
        "file": "/w/a.py",
        "start": start,
        "end": end,
    }
    # Empty ranges are allowed (a cursor position).
    assert graph.text_range("/w/a.py", start, start)["end"] == start


def test_text_range_with_a_revision() -> None:
    start, end = graph.position(3, 4), graph.position(4, 0)
    ghost = graph.text_range("/w/a.py", start, end, revision="3f2c1d9e")
    assert ghost == {"file": "/w/a.py", "start": start, "end": end, "revision": "3f2c1d9e"}
    assert "revision" not in graph.text_range("/w/a.py", start, end)


def test_text_range_rejects_bad_input() -> None:
    with pytest.raises(ValueError, match="needs a file"):
        graph.text_range("", graph.position(0, 0), graph.position(0, 1))
    with pytest.raises(ValueError, match="lies before its start"):
        graph.text_range("/w/a.py", graph.position(2, 0), graph.position(1, 9))
    with pytest.raises(ValueError, match="must not be empty"):
        graph.text_range("/w/a.py", graph.position(0, 0), graph.position(0, 1), revision="")


def test_unresolved_node() -> None:
    props: graph.UnresolvedProps = {
        "reasonCode": "dynamic-call",
        "expression": "getattr(self, name)()",
    }
    assert graph.unresolved_node("u1", "getattr(self, name)()", "dynamic call", props) == {
        "id": "u1",
        "kind": "unresolved",
        "label": "getattr(self, name)()",
        "reason": "dynamic call",
        "props": {"reasonCode": "dynamic-call", "expression": "getattr(self, name)()"},
    }
    other = graph.unresolved_node("u2", "x", "why", {"reasonCode": "local-value"}, parent="py:a")
    assert other["parent"] == "py:a"
    with pytest.raises(ValueError, match="must explain why"):
        graph.unresolved_node("u3", "x", "", {"reasonCode": "dynamic-call"})


def test_meta() -> None:
    assert graph.meta() == {"engineVersion": ENGINE_VERSION, "durationMs": 0.0}
    assert graph.meta(duration_ms=2.5, base_revision="3f2c1d9e") == {
        "engineVersion": ENGINE_VERSION,
        "durationMs": 2.5,
        "baseRevision": "3f2c1d9e",
    }


def test_empty_document() -> None:
    assert graph.empty_document("classAnatomy", duration_ms=1.5) == {
        "schemaVersion": 2,
        "view": "classAnatomy",
        "nodes": [],
        "edges": [],
        "diagnostics": [],
        "meta": {"engineVersion": ENGINE_VERSION, "durationMs": 1.5},
    }
    first, second = graph.empty_document("callGraph"), graph.empty_document("callGraph")
    first["nodes"].append(graph.unresolved_node("u", "x", "y", {"reasonCode": "dynamic-call"}))
    assert second["nodes"] == []
    assert first["meta"] is not second["meta"]
