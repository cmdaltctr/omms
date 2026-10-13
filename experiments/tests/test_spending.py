"""Check conservative spending reservations before hosted calls."""

import importlib
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def module():
    assert (Path(__file__).resolve().parents[1] / "spending.py").is_file(), "Spending guard required"
    return importlib.import_module("spending")


def test_reservation_precedes_call_and_usage_settles(tmp_path):
    budget = module().Budget(tmp_path / "spending.json", tmp_path, "a" * 64, 0.01)
    ticket = budget.reserve(0.002688)
    assert budget.used == 0.002688
    budget.settle(ticket, 0.0000126)
    assert budget.used == pytest.approx(0.0000126)
    restored = module().Budget(tmp_path / "spending.json", tmp_path, "a" * 64, 0.01, resume=True)
    assert restored.used == pytest.approx(0.0000126)


def test_unknown_usage_keeps_reservation_and_blocks_overspend(tmp_path):
    budget = module().Budget(tmp_path / "spending.json", tmp_path, "a" * 64, 0.003)
    budget.reserve(0.002688)
    with pytest.raises(ValueError, match="spending"):
        budget.reserve(0.002688)
    restored = module().Budget(tmp_path / "spending.json", tmp_path, "a" * 64, 0.003, resume=True)
    assert restored.used == pytest.approx(0.002688)


def test_changed_budget_and_invalid_settlement_refused(tmp_path):
    budget = module().Budget(tmp_path / "spending.json", tmp_path, "a" * 64, 0.01)
    ticket = budget.reserve(0.002688)
    with pytest.raises(ValueError, match="limit"):
        module().Budget(tmp_path / "spending.json", tmp_path, "a" * 64, 0.02, resume=True)
    with pytest.raises(ValueError):
        budget.settle(ticket, float("nan"))
    with pytest.raises(ValueError):
        budget.settle(ticket, 0.01)
    assert budget.used == 0.002688
