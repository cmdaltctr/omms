import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import run  # noqa: E402


def test_embed_json_keeps_script_end_tags_out_of_the_page():
    items = [{"memory": "a </script><script>x()</script> b </SCRIPT> <!-- c"}]
    page = "<script>const ITEMS=__ITEMS__;</script>".replace("__ITEMS__", run.embed_json(items))
    assert page.lower().count("</script>") == 1  # only the real closing tag
    assert "<!--" not in page


def test_embed_json_round_trips():
    items = [{"memory": "a </script> b <i>", "n": 1}]
    assert json.loads(run.embed_json(items)) == items
