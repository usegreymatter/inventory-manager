"""Sample, bounded local CSV, and read-only Odoo inventory sources."""
from __future__ import annotations

import csv
import io
import json
import math
import re
import ssl
import sys
import xmlrpc.client
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation
from types import MappingProxyType
from urllib.parse import urlsplit

from .engine import month_after, valid_month, MONTH_RANGE_REASON, MAX_QUANTITY, MAX_SUPPLIER_DAYS, valid_external_source
from pathlib import Path

MAX_CSV_BYTES = 2 * 1024 * 1024
MAX_ROWS = 10000
MONTH_RE = re.compile(r"^[1-9]\d{3}-(0[1-9]|1[0-2])$")


# --- ERP export headers -----------------------------------------------------
# Common column names from SAP Business One, NetSuite, Zoho Inventory, QuickBooks,
# Microsoft Dynamics and Odoo exports, mapped to Stock Runway's canonical columns.
# Mirrored exactly in desktop/plugin.js (ERP_ALIASES / normalizeErpRows).
ERP_ALIASES = {'sku': ['sku', 'item code', 'itemcode', 'item no', 'item number', 'item id', 'product code', 'product id', 'internal reference', 'default code', 'part number', 'part no', 'article', 'article number', 'material', 'no', 'stock code', 'item ref', 'product internal reference', 'product sku', 'material number', 'item sku', 'variant sku', 'barcode', 'sku no'], 'name': ['item name', 'itemname', 'product name', 'display name', 'item description', 'material description', 'product service', 'name', 'description', 'product', 'item', 'product product', 'material desc', 'item desc', 'product description', 'title', 'product title', 'stock description'], 'unit': ['unit', 'uom', 'unit of measure', 'units', 'stock uom', 'inventory uom', 'base unit', 'base unit of measure', 'inventory unit', 'usage unit', 'invntryuom', 'uom name', 'unit name', 'product unit of measure', 'stocking unit', 'sales unit'], 'on_hand': ['on hand', 'qty on hand', 'quantity on hand', 'in stock', 'stock on hand', 'onhand', 'qty in stock', 'quantity in stock', 'available', 'qty available', 'quantity available', 'available quantity', 'current stock', 'stock', 'inventory', 'free stock', 'on hand quantity', 'qty', 'quantity', 'unrestricted', 'unrestricted stock', 'total stock', 'physical stock', 'closing stock', 'balance', 'qty in hand', 'stock quantity', 'inventory quantity', 'available stock', 'stock level', 'quantity available for sale', 'qtyonhand'], 'supplier_days': ['supplier days', 'lead time', 'lead time days', 'lead days', 'purchase lead time', 'vendor lead time', 'supplier lead time', 'delivery lead time', 'delivery days', 'lead time in days', 'procurement lead time', 'replenishment lead time', 'purchasing lead time', 'delivery time', 'planned delivery time', 'planned delivery time days', 'vendor lead time days', 'leadtime', 'product vendors delivery lead time', 'product vendors delay', 'delay'], 'category': ['category', 'item group', 'item category', 'product category', 'group', 'class', 'family', 'category name', 'itmsgrpnam', 'product category name', 'product type', 'department', 'item type', 'item class', 'sub category', 'stock category'], 'supplier': ['supplier', 'vendor', 'supplier name', 'vendor name', 'partner', 'main supplier', 'preferred supplier', 'preferred vendor'], 'last_count_date': ['last count date'], 'demand_change_pct': ['demand change pct'], 'on_order': ['on order', 'qty on order', 'quantity on order', 'on po', 'open po qty', 'incoming', 'incoming qty', 'ordered qty', 'expected', 'in transit'], 'location': ['warehouse', 'warehouse name', 'warehouse code', 'location', 'location name', 'stock location', 'location complete name'], 'active': ['active'], 'inactive': ['inactive'], 'minimum_order': ['minimum order', 'minordrqty', 'min ordr qty', 'min qty', 'minimum order quantity', 'moq'], 'pack_size': ['pack size', 'pack', 'qty per pack'], 'unit_cost': ['unit cost', 'cost', 'avgprice', 'avg price', 'standard price'], 'sale_price': ['sale price', 'price', 'selling price', 'retail price', 'sales price', 'list price']}

ERP_ALIASES.update({
    'shelf_life_days': ['shelf life days', 'shelf life', 'shelf life in days'],
    'lot': ['lot', 'batch', 'lot number', 'batch number', 'lot no', 'batch no'],
    'expiry': ['expiry', 'expiry date', 'expiration date', 'best before', 'use by', 'lot expiry'],
    'lot_qty': ['lot qty', 'lot quantity', 'batch qty', 'batch quantity'],
    'lots': ['lots'],
})

_ALIAS_LOOKUP = {}
for _canon, _names in ERP_ALIASES.items():
    for _rank, _n in enumerate(_names):
        _ALIAS_LOOKUP.setdefault(_n, (_canon, _rank))
_MONTHS = {m: i + 1 for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"])}


def _header_key(raw: str) -> str:
    split = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", raw.strip())
    return " ".join(re.sub(r"[\s\-_./():]+", " ", split.replace("#", " no").lower()).split())


def _erp_number(raw: str) -> str:
    """Remove valid thousands grouping only; leave malformed cells for validation."""
    if re.fullmatch(r"\s*[+-]?[0-9]{1,3}(,[0-9]{3})+(\.[0-9]+)?\s*", raw):
        return raw.replace(",", "")
    return raw


def erp_month(raw: str):
    """Return YYYY-MM for common ERP month labels, else None."""
    t = raw.strip()
    m = re.fullmatch(r"([0-9]{1,2})([/.])([0-9]{1,2})\2([1-9][0-9]{3})", t)
    if m:
        first, separator, second, year = m.groups()
        mo, day = (int(first), int(second)) if separator == "/" else (int(second), int(first))
        return f"{year}-{mo:02d}" if day == 1 and 1 <= mo <= 12 else None
    m = re.fullmatch(r"([1-9]\d{3})[-/.](\d{1,2})(?:[-/.]\d{1,2})?", t)
    if m:
        y, mo = int(m.group(1)), int(m.group(2))
    else:
        m = re.fullmatch(r"(\d{1,2})[-/.]([1-9]\d{3})", t)
        if m:
            mo, y = int(m.group(1)), int(m.group(2))
        else:
            m = re.fullmatch(r"([A-Za-z]{3,9})[\s\-/.,']*(\d{4}|\d{2})", t)
            if not m or m.group(1)[:3].lower() not in _MONTHS:
                return None
            name = m.group(1).lower()
            full = ["january", "february", "march", "april", "may", "june", "july", "august",
                    "september", "october", "november", "december"][_MONTHS[name[:3]] - 1]
            if not (name == name[:3] or full.startswith(name)) and name not in ("sept",):
                return None
            mo = _MONTHS[name[:3]]
            y = int(m.group(2)) + (2000 if len(m.group(2)) == 2 else 0)
    if not 1 <= mo <= 12:
        return None
    return f"{y:04d}-{mo:02d}"


def normalize_erp_rows(rows: list[list[str]]) -> list[list[str]]:
    """Rewrite an ERP export (any column order/names) into canonical column order.

    Canonical files are returned unchanged. Otherwise known columns are renamed,
    month labels become YYYY-MM (``rcv:`` prefix kept), missing unit defaults to
    "units", missing supplier_days is blank, and unrecognised columns are dropped.
    """
    if not rows:
        return rows
    headers = rows[0]
    if headers[:5] == ["sku", "name", "unit", "on_hand", "supplier_days"] and not any(_header_key(h) in ERP_ALIASES["supplier"][1:] for h in headers[5:]):
        return rows
    picked, ranks, months, receipts = {}, {}, [], []
    for idx, raw in enumerate(headers):
        key = _header_key(raw)
        rcv = key.startswith("rcv ") or raw.strip().lower().startswith("rcv:")
        label = raw.strip()[4:] if raw.strip().lower().startswith("rcv:") else raw
        month = erp_month(label)
        if month and rcv:
            receipts.append((f"rcv:{month}", idx))
            continue
        if month:
            months.append((month, idx))
            continue
        hit = _ALIAS_LOOKUP.get(key) or _ALIAS_LOOKUP.get(key.replace(" ", ""))
        if hit:
            canon, rank = hit
            if canon not in ranks or rank < ranks[canon]:
                picked[canon], ranks[canon] = idx, rank
    # NetSuite: "Name" is the item code when "Display Name" holds the description.
    if "sku" not in picked and "name" in picked:
        plain = [i for i, h in enumerate(headers) if _header_key(h) == "name" and i != picked["name"]]
        if plain:
            picked["sku"] = plain[0]
        elif _header_key(headers[picked["name"]]) == "name":
            descriptions = [i for i, h in enumerate(headers) if _header_key(h) == "description"]
            if descriptions:
                picked["sku"], picked["name"] = picked["name"], descriptions[0]
    months.sort()
    receipts.sort()
    if not {"sku", "name", "on_hand"} <= picked.keys():
        return rows  # let the strict validator explain what is missing
    if "on_order" in picked and headers[picked["on_order"]] != "on_order":
        index = picked["on_order"]
        # Old ERP exports also use Expected for dates/text. Only interpret an
        # alias as quantities if at least one nonblank cell has numeric syntax.
        # Range/finite validation still rejects invalid numbers and mixed rows.
        values = [_erp_number(r[index]).strip() for r in rows[1:] if index < len(r) and r[index].strip()]
        if not any(re.fullmatch(r"[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?", value, re.ASCII) for value in values):
            del picked["on_order"]
    order = ["sku", "name", "unit", "on_hand", "supplier_days"]
    out_headers = order + (["category"] if "category" in picked else []) + (["supplier"] if "supplier" in picked else []) + (["on_order"] if "on_order" in picked else []) + (["demand_change_pct"] if "demand_change_pct" in picked else []) + (["last_count_date"] if "last_count_date" in picked else []) + [m for m, _ in months] + [r for r, _ in receipts]
    out = [out_headers]
    for r in rows[1:]:
        if not any(cell.replace("\ufeff", "").strip() for cell in r):
            continue
        get = lambda i: r[i] if i is not None and i < len(r) else ""
        line = [get(picked["sku"]), get(picked["name"]),
                get(picked["unit"]) if "unit" in picked else "units",
                _erp_number(get(picked["on_hand"])),
                _erp_number(get(picked.get("supplier_days"))) if "supplier_days" in picked else ""]
        if "category" in picked:
            line.append(get(picked["category"]))
        if "supplier" in picked:
            line.append(get(picked["supplier"]))
        if "on_order" in picked:
            line.append(_erp_number(get(picked["on_order"])))
        if "demand_change_pct" in picked:
            line.append(get(picked["demand_change_pct"]))
        if "last_count_date" in picked:
            line.append(get(picked["last_count_date"]))
        line += [_erp_number(get(i)) if get(i).strip() else "0" for _, i in months]
        line += [_erp_number(get(i)) for _, i in receipts]
        if len(r) != len(headers):
            line.append("")  # keep the strict column-count error
        out.append(line)
    return out


class SourceError(ValueError):
    pass


def load_sample(path: Path | None = None) -> dict:
    path = path or Path(__file__).parent / "data" / "sample.json"
    try:
        with path.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, json.JSONDecodeError):
        raise SourceError("The bundled sample data could not be read.") from None
    return data


def _number(raw: str, row: int, column: str, *, nullable: bool = False):
    if raw == "" and nullable:
        return None
    if column == "on_order" and (not isinstance(raw, str) or not raw.strip().isascii()):
        raise SourceError(f"Row {row}: {column} must be a number.")
    if not isinstance(raw, str) or not re.fullmatch(r"[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?", raw.strip()):
        raise SourceError(f"Row {row}: {column} must be a number.")
    try:
        value = float(raw)
    except (TypeError, ValueError):
        raise SourceError(f"Row {row}: {column} must be a number.") from None
    if not math.isfinite(value) or value < 0:
        raise SourceError(f"Row {row}: {column} must be a non-negative number.")
    limit = MAX_SUPPLIER_DAYS if column == "supplier_days" else MAX_QUANTITY
    if value > limit:
        raise SourceError(f"Row {row}: {column} must be no greater than {limit}.")
    return int(value) if value.is_integer() else value


def _csv_byte_limit(max_bytes):
    """Validate explicit per-call limits without changing shared import defaults."""
    if type(max_bytes) is not int or not 1 <= max_bytes < sys.maxsize:
        raise SourceError(f"max_bytes must be an integer from 1 to {sys.maxsize - 1}.")
    return '2 MiB' if max_bytes == MAX_CSV_BYTES else f'{max_bytes} bytes'


def _read_csv_bytes(handle, max_bytes):
    """Read at most the budget plus one, without preallocating a large budget."""
    remaining = max_bytes + 1
    chunks = []
    while remaining:
        chunk = handle.read(min(remaining, 64 * 1024))
        if not chunk:
            break
        chunks.append(chunk)
        remaining -= len(chunk)
    return b''.join(chunks)


def load_csv(path: str, receipts_path: str | None = None, *, strict: bool = False,
             max_bytes: int = MAX_CSV_BYTES) -> dict:
    from .csv_import import import_csv
    data = import_csv(path, strict=strict, max_bytes=max_bytes)
    if receipts_path:
        load_receipts(receipts_path, data["months"], data["items"], max_bytes=max_bytes)
    return data


def _parse_canonical_csv(raw_rows):
    buffer = io.StringIO()
    csv.writer(buffer, lineterminator="\n").writerows(raw_rows)
    buffer.seek(0)
    handle = buffer
    reader = csv.DictReader(handle, strict=True)
    headers = reader.fieldnames or []
    fixed = ["sku", "name", "unit", "on_hand", "supplier_days"]
    if headers[:5] != fixed:
        raise SourceError("CSV columns must begin: sku,name,unit,on_hand,supplier_days. Common ERP names also work, e.g. Item Code, Item Name, UoM, Qty On Hand, Lead Time.")
    extra = headers[5:]
    months = [h for h in extra if h not in {"category", "supplier", "on_order", "demand_change_pct", "last_count_date"} and not h.startswith("rcv:")]
    if len(months) < 3 or any(not MONTH_RE.fullmatch(m) for m in months):
        raise SourceError("Add at least three YYYY-MM monthly sales columns after supplier_days.")
    if any(not valid_month(m) for m in months):
        raise SourceError(MONTH_RANGE_REASON)
    if sorted(months) != months or len(set(months)) != len(months):
        raise SourceError("Monthly sales columns must be unique and in chronological order.")
    if any(month_after(months[i - 1], 1) != months[i] for i in range(1, len(months))):
        raise SourceError("Monthly sales columns must be consecutive full months.")
    receipt_columns = [h for h in extra if h.startswith("rcv:")]
    if extra.count("category") > 1:
        raise SourceError("Category column must be unique.")
    if extra.count("supplier") > 1:
        raise SourceError("Supplier column must be unique.")
    if extra.count("on_order") > 1:
        raise SourceError("On order column must be unique.")
    if extra.count("demand_change_pct") > 1:
        raise SourceError("demand_change_pct column must be unique.")
    if extra.count("last_count_date") > 1:
        raise SourceError("last_count_date column must be unique.")
    if receipt_columns and (len(set(receipt_columns)) != len(receipt_columns)
            or any(not MONTH_RE.fullmatch(h[4:]) for h in receipt_columns)
            or set(h[4:] for h in receipt_columns) != set(months)):
        raise SourceError("Receipt columns must be unique valid rcv:YYYY-MM columns covering every sales month exactly.")
    items = []
    seen = set()
    for rownum, row in enumerate(reader, 2):
        if len(items) >= MAX_ROWS:
            raise SourceError("CSV contains more than 10000 rows.")
        if None in row or any(row.get(key) is None for key in headers):
            raise SourceError(f"Row {rownum}: column count does not match the header.")
        if any(not row[k].strip() for k in fixed[:3]):
            raise SourceError(f"Row {rownum}: sku, name, and unit are required.")
        if row["sku"].strip() in seen:
            raise SourceError(f"Row {rownum}: duplicate sku.")
        seen.add(row["sku"].strip())
        items.append({"sku": row["sku"].strip(), "name": row["name"].strip(), "unit": row["unit"].strip(),
                      "on_hand": _number(row["on_hand"], rownum, "on_hand"),
                      "supplier_days": _number(row["supplier_days"], rownum, "supplier_days", nullable=True),
                      "monthly_sales": [_number(row[m], rownum, m) for m in months], "receipts": {}})
        if "category" in extra:
            items[-1]["category"] = row["category"].strip()
        if "supplier" in extra:
            items[-1]["supplier"] = row["supplier"].strip()
        if "on_order" in extra and row["on_order"].strip():
            items[-1]["on_order"] = _number(row["on_order"], rownum, "on_order")
        if "demand_change_pct" in extra and row["demand_change_pct"].strip():
            value = row['demand_change_pct'].strip()
            if (not re.fullmatch(r'[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?', value)
                    or not math.isfinite(float(value)) or not -90 <= float(value) <= 300):
                raise SourceError(f"Row {rownum}: demand_change_pct must be a number from -90 to 300.")
            items[-1]['demand_change_pct'] = float(value)
        if "last_count_date" in extra and row["last_count_date"].strip():
            value = row['last_count_date'].strip()
            try:
                if not re.fullmatch(r'[0-9]{4}-[0-9]{2}-[0-9]{2}', value):
                    raise ValueError
                date.fromisoformat(value)
            except ValueError:
                raise SourceError(f"Row {rownum}: last_count_date must be a real YYYY-MM-DD date.") from None
            items[-1]['last_count_date'] = value
        if receipt_columns:
            items[-1]["historical_receipts"] = {h[4:]: _number(row[h], rownum, h) for h in receipt_columns}
    if not items:
        raise SourceError("CSV has no item rows.")
    return {"as_of": _month_end(months[-1]), "months": months, "items": items}

def _month_end(month: str) -> str:
    from calendar import monthrange
    year, number = map(int, month.split("-"))
    return date(year, number, monthrange(year, number)[1]).isoformat()


def load_receipts(path: str, months: list[str], items: list[dict], *,
                  max_bytes: int = MAX_CSV_BYTES) -> None:
    limit = _csv_byte_limit(max_bytes)
    size_error = f"Receipts CSV must be a local file no larger than {limit}."
    try:
        p = Path(path).expanduser().resolve(strict=True)
        if not p.is_file() or p.stat().st_size > max_bytes:
            raise SourceError(size_error)
        with p.open("rb") as source:
            raw = _read_csv_bytes(source, max_bytes)
        if len(raw) > max_bytes:
            raise SourceError(size_error)
        with io.StringIO(raw.decode("utf-8-sig"), newline="") as handle:
            reader = csv.DictReader(handle, strict=True)
            if reader.fieldnames != ["sku", "month", "quantity"]:
                raise SourceError("Receipts CSV columns must be: sku,month,quantity.")
            by_sku = {item["sku"]: item for item in items}
            for rownum, row in enumerate(reader, 2):
                if rownum > MAX_ROWS + 1:
                    raise SourceError("Receipts CSV contains more than 10000 rows.")
                if None in row or any(v is None for v in row.values()):
                    raise SourceError(f"Receipts row {rownum}: column count does not match the header.")
                if row["sku"] not in by_sku or not MONTH_RE.fullmatch(row["month"]) or row["month"] > month_after(months[-1], 12):
                    raise SourceError(f"Receipts row {rownum}: SKU is unknown or month is invalid or beyond the 12-month horizon.")
                if row["month"] <= months[-1]:
                    raise SourceError(f"Receipts row {rownum}: month must be after the last sales month.")
                quantity = _number(row["quantity"], rownum, "quantity")
                total = by_sku[row["sku"]]["receipts"].get(row["month"], 0) + quantity
                if total > MAX_QUANTITY:
                    raise SourceError(f"Receipts row {rownum}: monthly total must be no greater than {MAX_QUANTITY}.")
                by_sku[row["sku"]]["receipts"][row["month"]] = total
    except SourceError:
        raise
    except (OSError, UnicodeError, csv.Error, KeyError, TypeError):
        raise SourceError("Could not read the local receipts CSV file.") from None


ALLOWED_METHODS = frozenset({"search_read"})
ALLOWED_DOMAIN_FIELDS = frozenset({"default_code", "usage", "product_id", "location_id", "location_dest_id", "state", "date", "product_tmpl_id", "id"})
ALLOWED_FIELDS = MappingProxyType({
    "uom.uom": frozenset({"id", "factor", "category_id", "parent_path"}),
    "stock.location": frozenset({"id", "usage"}),
    "stock.move": frozenset({"product_id", "product_uom_qty", "product_uom", "quantity", "date", "state", "location_id", "location_dest_id"}),
    "stock.quant": frozenset({"product_id", "quantity", "location_id"}),
    "product.product": frozenset({"id", "name", "default_code", "uom_id", "product_tmpl_id", "categ_id"}),
    "product.supplierinfo": frozenset({"product_tmpl_id", "product_id", "delay", "partner_id", "sequence"}),
})


class OdooReadOnly:
    """Only the authentication handshake and field-guarded inventory reads."""

    def __init__(self, secret_getter=None, server_proxy_factory=None, transport_factory=None):
        self.secret_getter = secret_getter
        self.server_proxy_factory = server_proxy_factory or xmlrpc.client.ServerProxy
        self.transport_factory = transport_factory or _SafeTransport
        self._credentials = None
        self._uom19 = False

    def _secret(self, name):
        try:
            getter = self.secret_getter
            if getter is None:
                from agent.secret_scope import get_secret
                getter = get_secret
            value = getter(name)
            if not isinstance(value, str) or not value:
                raise ValueError
            return value
        except Exception:
            raise SourceError("Odoo connection is not configured in Hermes secrets.") from None

    def _call(self, proxy, model, method, args, kwargs):
        # Validate before looking up any transport attribute, even for fields_get.
        if method not in ALLOWED_METHODS:
            raise SourceError("Odoo write or unsupported operations are not allowed.")
        if model not in ALLOWED_FIELDS:
            raise SourceError("Odoo model is not allowed.")
        fields = kwargs.get("fields")
        if not isinstance(fields, (list, tuple)) or not fields or any(f not in ALLOWED_FIELDS[model] for f in fields):
            raise SourceError("Odoo field is not allowed.")
        if not isinstance(args, (list, tuple)) or len(args) != 1 or not isinstance(args[0], list):
            raise SourceError("Odoo query arguments are not allowed.")
        for leaf in args[0]:
            if isinstance(leaf, str) and leaf in ("&", "|", "!"):
                continue
            if (not isinstance(leaf, (list, tuple)) or len(leaf) != 3
                    or not isinstance(leaf[0], str) or leaf[0] not in ALLOWED_DOMAIN_FIELDS):
                raise SourceError("Odoo domain field is not allowed.")
        if set(kwargs) - {"fields", "limit", "offset", "order", "context"} or kwargs.get("order") not in ("id", None):
            raise SourceError("Odoo query option is not allowed.")
        if "context" in kwargs:
            context = kwargs["context"]
            if (model != "uom.uom" or not isinstance(context, dict)
                    or set(context) != {"active_test"} or context["active_test"] is not False):
                raise SourceError("Odoo query option is not allowed.")
        try:
            db, uid, key = self._credentials
            return proxy.execute_kw(db, uid, key, model, method, args, kwargs)
        except xmlrpc.client.Fault as exc:
            # Only field absence triggers the compatibility retry; contents never escape.
            message = str(exc.faultString).lower()
            if model == "stock.move" and "quantity" in fields and "quantity" in message and any(x in message for x in ("invalid field", "unknown field", "does not exist")):
                fallback = [f for f in fields if f != "quantity"]
                return self._call(proxy, model, method, args, {**kwargs, "fields": fallback})
            if model == "uom.uom" and "category_id" in fields and "category_id" in message and any(x in message for x in ("invalid field", "unknown field", "does not exist")):
                self._uom19 = True
                return self._call(proxy, model, method, args, {**kwargs, "fields": ["id", "factor", "parent_path"]})
            raise SourceError("Odoo could not return the requested inventory data.") from None
        except Exception:
            raise SourceError("Odoo could not return the requested inventory data.") from None

    def _authenticate(self, common, db, user, key):
        try:
            uid = common.authenticate(db, user, key, {})
            if not isinstance(uid, int) or isinstance(uid, bool) or uid <= 0:
                raise ValueError
            return uid
        except Exception:
            raise SourceError("Odoo authentication failed.") from None

    def _read(self, proxy, model, domain, fields):
        # Explicit pagination prevents server defaults from silently truncating stock.
        rows = []
        for offset in range(0, 100000, 1000):
            options = {"fields": fields, "offset": offset, "limit": 1000, "order": "id"}
            if model == "uom.uom":
                options["context"] = {"active_test": False}
                if self._uom19:
                    options["fields"] = ["id", "factor", "parent_path"]
            batch = self._call(proxy, model, "search_read", [domain], options)
            if not isinstance(batch, list):
                raise SourceError("Odoo returned incomplete inventory data.")
            rows.extend(batch)
            if len(batch) < 1000:
                return rows
        raise SourceError("Odoo inventory exceeds the safe read limit; narrow the SKU list.")

    def load(self, skus=None, *, today=None):
        if not isinstance(skus, list) or not 1 <= len(skus) <= 50 or any(not isinstance(s, str) or not s.strip() for s in skus):
            raise SourceError("Odoo requires a list of 1 to 50 product SKUs.")
        self._uom19 = False  # Schema selection belongs to this load, not a previous server.
        url, db, user, key = (self._secret(n) for n in ("ODOO_URL", "ODOO_DB", "ODOO_USER", "ODOO_API_KEY"))
        try:
            parsed = urlsplit(url)
            if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
                raise ValueError
            parsed.port
        except ValueError:
            raise SourceError("Odoo requires an HTTPS server URL without credentials, query or fragment.") from None
        try:
            common = self.server_proxy_factory(url.rstrip("/") + "/xmlrpc/2/common", transport=self.transport_factory(), allow_none=True)
            uid = self._authenticate(common, db, user, key)
            self._credentials = (db, uid, key)
            proxy = self.server_proxy_factory(url.rstrip("/") + "/xmlrpc/2/object", transport=self.transport_factory(), allow_none=True)
            products = self._read(proxy, "product.product", [("default_code", "in", skus)], sorted(ALLOWED_FIELDS["product.product"]))
            if set(skus) - {p.get("default_code") for p in products}:
                raise SourceError("One or more requested SKUs were not found.")
            seen_codes = set()
            for product in products:
                sku = product.get("default_code")
                if sku in seen_codes:
                    raise SourceError(f"Duplicate Odoo SKU: {sku}.")
                seen_codes.add(sku)
            locations = self._read(proxy, "stock.location", [("usage", "in", ["internal", "customer", "supplier"])], ["id", "usage"])
            internal = [r["id"] for r in locations if r["usage"] == "internal"]
            ids = [p["id"] for p in products]
            now = today or datetime.now(timezone.utc).date()
            last = month_after(now.strftime("%Y-%m"), -1)
            first = month_after(last, -11)
            quants = self._read(proxy, "stock.quant", [("product_id", "in", ids), ("location_id", "in", internal)], ["product_id", "quantity", "location_id"])
            moves = self._read(proxy, "stock.move", [("product_id", "in", ids), ("state", "=", "done"), ("date", ">=", first + "-01 00:00:00")], sorted(ALLOWED_FIELDS["stock.move"]))
            uom_ids = {_relation(p.get("uom_id")) for p in products}
            uom_ids.update(_relation(m.get("product_uom")) for m in moves)
            uoms = self._read(proxy, "uom.uom", [("id", "in", sorted(i for i in uom_ids if i))], ["id", "factor", "category_id"])
            templates = [_relation(p.get("product_tmpl_id")) for p in products]
            try:
                suppliers = self._read(proxy, "product.supplierinfo", [("product_tmpl_id", "in", templates)], sorted(ALLOWED_FIELDS["product.supplierinfo"])) if all(templates) else []
            except SourceError:
                suppliers = []  # Optional lead time remains unknown when access is unavailable.
            return _odoo_dataset(products, moves, quants, locations, suppliers, uoms=uoms, uom19=self._uom19, today=now)
        except SourceError:
            raise
        except Exception:
            raise SourceError("Odoo returned incomplete inventory data or the connection failed.") from None
        finally:
            self._credentials = None


class _SafeTransport(xmlrpc.client.SafeTransport):
    def __init__(self):
        super().__init__(context=ssl.create_default_context())

    def make_connection(self, host):
        connection = super().make_connection(host)
        connection.timeout = 30
        return connection


def _relation(value):
    return value[0] if isinstance(value, (list, tuple)) and value else value


def _odoo_dataset(products, moves, quants, locations, suppliers=(), *, uoms=(), uom19=False, today=None):
    now = today or datetime.now(timezone.utc).date()
    last = month_after(now.strftime("%Y-%m"), -1)
    months = [month_after(last, i - 11) for i in range(12)]
    internal = {r["id"] for r in locations if r["usage"] == "internal"}
    customer = {r["id"] for r in locations if r["usage"] == "customer"}
    vendor = {r["id"] for r in locations if r["usage"] == "supplier"}
    if not internal or not customer:
        raise SourceError("Odoo internal and customer locations are required.")
    items = []
    units = {unit["id"]: unit for unit in uoms}
    for product in products:
        pid = product["id"]
        monthly = dict.fromkeys(months, Decimal(0))
        incoming = dict.fromkeys(months, Decimal(0))
        history_complete = bool(vendor)
        hold_reason = None
        product_unit = units.get(_relation(product.get("uom_id")), {})
        stock = Decimal(0)
        limit_reason = "Quantities and monthly totals must be no greater than 1000000000000."
        for quant in quants:
            if _relation(quant["product_id"]) != pid or _relation(quant["location_id"]) not in internal:
                continue
            try:
                amount = Decimal(str(quant["quantity"]))
                if not amount.is_finite() or abs(amount) > MAX_QUANTITY:
                    raise ValueError
                stock += amount
                if abs(stock) > MAX_QUANTITY:
                    raise ValueError
            except (InvalidOperation, ValueError, TypeError):
                hold_reason = limit_reason
                stock = Decimal(0)
        for move in moves:
            if _relation(move["product_id"]) != pid or move["state"] != "done":
                continue
            month = datetime.fromisoformat(move["date"].replace("Z", "+00:00")).strftime("%Y-%m")
            src, dst = _relation(move["location_id"]), _relation(move["location_dest_id"])
            rollback = ((src in internal) - (dst in internal)) if month > last else 0
            sale = ((src in internal and dst in customer) - (src in customer and dst in internal)) if month in monthly else 0
            receipt = src in vendor and dst in internal and month in monthly
            if not rollback and not sale and not receipt:
                continue  # Internal transfers and other irrelevant moves need no unit conversion.
            receipt_only = receipt and not rollback and not sale
            try:
                quantity = Decimal(str(move["quantity"] if "quantity" in move else move["product_uom_qty"]))
            except (InvalidOperation, ValueError, TypeError):
                if not receipt_only:
                    raise
                history_complete = False
                continue
            if not quantity.is_finite() or quantity < 0:
                if receipt_only:
                    history_complete = False
                    continue
                raise SourceError("Odoo returned invalid move quantities.")
            move_unit = units.get(_relation(move.get("product_uom")), {})
            factors = [move_unit.get("factor"), product_unit.get("factor")]
            if uom19:
                paths = [unit.get("parent_path") for unit in (move_unit, product_unit)]
                references = [path.split("/")[0] if isinstance(path, str) else None for path in paths]
            else:
                references = [_relation(unit.get("category_id")) for unit in (move_unit, product_unit)]
            if (not references[0] or references[0] != references[1]
                    or any(isinstance(f, bool) or not isinstance(f, (int, float)) or not math.isfinite(f) or f <= 0 for f in factors)):
                if receipt_only:
                    history_complete = False
                else:
                    hold_reason = "Some moves use a unit that cannot be converted."
                continue
            if uom19:
                # Odoo 19 _compute_quantity: qty * self.factor / to_unit.factor (no rounding).
                quantity = quantity * Decimal(str(factors[0])) / Decimal(str(factors[1]))
            else:
                # Odoo 17/18 factors are the inverse of the Odoo 19 convention.
                quantity = quantity / Decimal(str(factors[0])) * Decimal(str(factors[1]))
            if not quantity.is_finite() or quantity > MAX_QUANTITY:
                if receipt_only:
                    history_complete = False
                else:
                    hold_reason = limit_reason
                continue
            if rollback:
                stock += quantity * rollback
                if abs(stock) > MAX_QUANTITY:
                    hold_reason = limit_reason
                    stock = Decimal(0)
            else:
                monthly[month] += quantity * sale
                if abs(monthly[month]) > MAX_QUANTITY:
                    hold_reason = limit_reason
                    monthly[month] = Decimal(0)
                if receipt:
                    incoming[month] += quantity
                    if incoming[month] > MAX_QUANTITY:
                        history_complete = False
                        incoming[month] = Decimal(0)
        delays = [float(s["delay"]) for s in suppliers if _relation(s.get("product_tmpl_id")) == _relation(product.get("product_tmpl_id")) and (not s.get("product_id") or _relation(s["product_id"]) == pid) and isinstance(s.get("delay"), (float, int)) and not isinstance(s["delay"], bool) and math.isfinite(s["delay"]) and s["delay"] > 0]
        if delays and max(delays) > MAX_SUPPLIER_DAYS:
            hold_reason = "Supplier days must be from 0 to 3650 when supplied."
        items.append({"sku": product["default_code"], "name": product["name"], "unit": product["uom_id"][1],
                      "on_hand": float(stock), "supplier_days": max(delays) if delays else None,
                      "monthly_sales": [float(value) for value in monthly.values()], "receipts": {}})
        # Preferred supplier is metadata only; keep the conservative max lead unchanged.
        matching = [s for s in suppliers if _relation(s.get("product_tmpl_id")) == _relation(product.get("product_tmpl_id"))
                    and (not s.get("product_id") or _relation(s["product_id"]) == pid)]
        preferred = min(matching, key=lambda s: s.get("sequence", 0), default={})
        partner = preferred.get("partner_id")
        items[-1]["supplier"] = partner[1].strip() if isinstance(partner, (list, tuple)) and len(partner) > 1 and isinstance(partner[1], str) else ""
        category = product.get("categ_id")
        items[-1]["category"] = category[1] if isinstance(category, (list, tuple)) and len(category) > 1 and isinstance(category[1], str) else ""
        if history_complete:
            items[-1]["historical_receipts"] = {month: float(value) for month, value in incoming.items()}
        if hold_reason:
            items[-1]["hold_reason"] = hold_reason
    return {"as_of": _month_end(last), "months": months, "items": items}


def load_forecasts(path, items):
    """Attach a bounded local challenger archive; never trust imported tails."""
    path = Path(path)
    if path.is_symlink() or not path.is_file() or path.stat().st_size > MAX_CSV_BYTES:
        raise SourceError('forecasts.csv must be a regular local file up to 2 MiB.')
    grouped = {item['sku']: [] for item in items}
    seen = set()
    try:
        with path.open(encoding='utf-8-sig', newline='') as handle:
            reader = csv.DictReader(handle, strict=True)
            headers = reader.fieldnames or []
            required = {'sku', 'month', 'p50', 'p80', 'p95', 'source'}
            if not required.issubset(headers) or len(headers) != len(set(headers)):
                raise ValueError('required unique headers: sku,month,p50,p80,p95,source')
            for index, row in enumerate(reader):
                if index >= MAX_ROWS or None in row or any(v is None for v in row.values()):
                    raise ValueError('invalid row count or width')
                sku, month, source, origin = row['sku'], row['month'], row['source'], row.get('origin', '')
                key = (sku, origin, month)
                if (sku not in grouped or not valid_month(month) or not valid_external_source(source)
                        or origin != '' and (not valid_month(origin) or origin >= month) or key in seen):
                    raise ValueError('unknown SKU, invalid month/source/origin or duplicate row')
                seen.add(key)
                if not re.fullmatch(r'[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?', row['p50'].strip()):
                    raise ValueError('p50 must be an ASCII decimal')
                p50 = float(row['p50'])
                if not math.isfinite(p50) or not 0 <= p50 <= MAX_QUANTITY:
                    raise ValueError('p50 outside quantity bounds')
                # Keep source/flags for provenance. Neither native nor heuristic
                # marginal tails are summed into a cumulative purchase interval.
                entry = dict(month=month, p50=p50, source=source)
                if 'origin' in row:
                    entry['origin'] = origin
                for field in ('p80', 'p95'):
                    flag = row.get(field+'_flag', row.get('flag', ''))
                    entry[field+'_flag'] = flag
                    if flag not in ('', 'native') or row[field] == '':
                        continue
                    if not re.fullmatch(r'[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?', row[field].strip()):
                        raise ValueError('native tail must be an ASCII decimal')
                    value = float(row[field])
                    if not math.isfinite(value) or not p50 <= value <= MAX_QUANTITY:
                        raise ValueError('native tail outside quantity bounds')
                    entry[field] = value
                if 'p80' in entry and 'p95' in entry and entry['p80'] > entry['p95']:
                    raise ValueError('crossed native quantiles')
                grouped[sku].append(entry)
        for archive in grouped.values():
            if len({row['source'].strip(' ') for row in archive}) > 1:
                raise ValueError('one external source per SKU required')
    except (OSError, UnicodeError, csv.Error, ValueError, TypeError) as exc:
        raise SourceError('Invalid forecasts.csv: '+str(exc)) from exc
    for item in items:
        if grouped[item['sku']]:
            item['external_forecasts'] = grouped[item['sku']]


def load_bundle(directory, *, today=None):
    """Explicit opt-in canonical sibling CSV import; single CSV stays unchanged.

    Preserve diagnostics per feature/SKU. Invalid optional facts lock purchases;
    they never become zero or invalidate unrelated SKU forecasts.
    """
    from .data_contract.validate import validate_bundle
    report = validate_bundle(directory, today=today)
    if any(e['file'] in ('stock.csv', 'manifest.json') for e in report['errors']):
        raise SourceError('Bundle stock or manifest needs checking with data_contract/validate.py.')
    root = Path(directory)
    data = load_csv(str(root / 'stock.csv'))
    table_headers = {}
    def rows(filename):
        path = root / filename
        if not path.exists() or path.is_symlink() or not path.is_file() or path.stat().st_size > MAX_CSV_BYTES:
            return []
        try:
            with path.open(encoding='utf-8-sig', newline='') as handle:
                reader = csv.DictReader(handle, strict=True)
                table_headers[filename] = reader.fieldnames or []
                return list(reader)[:MAX_ROWS]
        except (OSError, UnicodeError, csv.Error):
            return []
    incoming = rows('incoming_pos.csv')
    customers = rows('customer_orders.csv')
    states = rows('stock_states.csv')
    sales_history = rows('sales_history.csv')
    warehouses = [r.get('warehouse') for r in rows('warehouses.csv')]
    legacy = root / 'legacy_receipts.csv'
    if legacy.exists() and any(e['file'] == 'legacy_receipts.csv' for e in report['errors']):
        raise SourceError('Bundle legacy receipts need checking; no purchases calculated.')
    if legacy.exists():
        load_receipts(str(legacy), data['months'], data['items'])
    def numeric_rows(selected, fields):
        for row in selected:
            for field in fields:
                try:
                    value = float(row[field])
                    row[field] = value if math.isfinite(value) else None
                except (KeyError, ValueError, TypeError, OverflowError):
                    row[field] = None
        return selected
    for item in data['items']:
        facts = dict(version='1.0', warehouses=warehouses)
        errors = {}
        for feature, table, records, numeric in (
                ('dated_incoming', 'incoming_pos', incoming, ['remaining_qty']),
                ('committed_demand', 'customer_orders', customers, ['quantity']),
                ('stockout_correction', 'sales_history', sales_history, ['quantity', 'in_stock_days'])):
            gate = report['features'][feature]['items'][item['sku']]
            selected = [dict(r) for r in records if r.get('sku') == item['sku']]
            if selected:
                # Preserve omitted exposure headers for project-only evidence;
                # explicit blank exposure remains declared unknown, never zero.
                has_projects = table == 'sales_history' and any('project' in r for r in selected)
                original_fields = [set(r) for r in selected] if has_projects else []
                facts[table] = numeric_rows(selected, numeric)
                if table == 'customer_orders':
                    for row in facts[table]:
                        flag = row.get('forecast_included')
                        row['forecast_included'] = True if flag == 'true' else False if flag == 'false' else None
                if table == 'sales_history':
                    for index,row in enumerate(facts[table]):
                        if not has_projects or 'backorder' in original_fields[index]:
                            flag = row.get('backorder')
                            row['backorder'] = True if flag == 'true' else False if flag == 'false' else None
                        if has_projects and 'in_stock_days' not in original_fields[index]:
                            row.pop('in_stock_days', None)
                        if 'project' in row:
                            flag = row['project']
                            row['project'] = True if flag == 'true' else False if flag == 'false' else None
                    if has_projects:
                        project_gate = report['features']['project_exclusion']['items'][item['sku']]
                        if project_gate['error_codes']:
                            errors['project_exclusion'] = project_gate['error_codes']
            if gate['error_codes']:
                errors[feature] = gate['error_codes']
        if 'project' in table_headers.get('sales_history.csv', []):
            project_gate = report['features']['project_exclusion']['items'][item['sku']]
            if project_gate['error_codes']:
                errors['project_exclusion'] = project_gate['error_codes']
        if 'customer_orders' in facts:
            selected_states = [dict(r) for r in states if r.get('sku') == item['sku']]
            if selected_states:
                facts['stock_states'] = numeric_rows(selected_states, ['damaged', 'reserved', 'quarantine', 'returns'])
            reservation_errors = sorted({e['code'] for e in report['errors']
                if e['file'] in ('stock_states.csv', 'warehouse_stock.csv') and e['sku'] in (None, item['sku'])})
            if reservation_errors:
                errors['reservations'] = reservation_errors
        if errors:
            facts['errors'] = errors
        if errors or 'incoming_pos' in facts or 'customer_orders' in facts or 'sales_history' in facts:
            item['planning_facts'] = facts
    forecasts = root / 'forecasts.csv'
    if forecasts.exists() or forecasts.is_symlink():
        try:
            load_forecasts(forecasts, data['items'])
        except SourceError:
            # Optional archive is atomic: retain valid stock, discard all rows.
            data['external_ignored'] = True
    data.update(bundle_version='1.0', decision_date=report['decision_date'], bundle_health=report)
    return data
