/* global VSC_PO */
(function () {
  if (!window.VSC_PO) return;

  const state = {
    items: [],
    suppliers: [],
    categories: [],
    page: 1,
    per_page: 20,
    total: 0,
    search: "",
    category: "",
    // '' = sin filtro (equivalente a "Todos"), pero mostrando placeholder
    stock: "",
    supplier_ids: [],
    dirtyInventory: new Map(),
    originalInventory: new Map(),
    select: new Set(),
    editStockEnabled: new Set(),
    orders: null,
    modal: { open: false, product_id: null, mode: "" },
    isLoading: false,
  };

  const $ = (id) => document.getElementById(id);

  function showLoading(text = "Cargando...") {
    state.isLoading = true;
    $("vscPoLoadingOverlay").style.display = "flex";
    $("vscPoLoadingText").textContent = text;
  }

  function hideLoading() {
    state.isLoading = false;
    $("vscPoLoadingOverlay").style.display = "none";
  }

  function updateStats() {
    const totalEl = $("vscPoTotalItems");
    const selectedEl = $("vscPoSelectedItems");
    const dirtyEl = $("vscPoDirtyItems");

    if (totalEl) totalEl.textContent = `${state.total} productos`;
    if (selectedEl)
      selectedEl.textContent = `${state.select.size} seleccionados`;
    if (dirtyEl)
      dirtyEl.textContent = `${state.dirtyInventory.size} cambios pendientes`;
  }

  function updateStockFilterUI() {
    const sel = $("vscPoStockFilter");
    if (!sel) return;
    sel.classList.remove(
      "vsc-po-stockfilter--out",
      "vsc-po-stockfilter--low",
      "vsc-po-stockfilter--good",
    );
    const v = sel.value;
    if (v === "out") sel.classList.add("vsc-po-stockfilter--out");
    if (v === "low") sel.classList.add("vsc-po-stockfilter--low");
    if (v === "good") sel.classList.add("vsc-po-stockfilter--good");
  }

  function setupClearableFilters() {
    const configs = [
      {
        id: "vscPoCategory",
        isActive: (sel) => !!sel.value,
        onClear: (sel) => {
          sel.value = "";
          sel.dispatchEvent(new Event("change", { bubbles: true }));
        },
      },
      {
        id: "vscPoStockFilter",
        isActive: (sel) => !!sel.value,
        onClear: (sel) => {
          sel.value = "";
          // refleja el color del stock filter (si aplica)
          updateStockFilterUI();
          sel.dispatchEvent(new Event("change", { bubbles: true }));
        },
      },
      {
        id: "vscPoSupplierFilter",
        // Multi-select: activo si hay al menos 1 proveedor seleccionado
        isActive: () =>
          Array.isArray(state.supplier_ids) && state.supplier_ids.length > 0,
        onClear: () => {
          state.supplier_ids = [];
          renderSupplierFilter();
          state.page = 1;
          loadItems();
        },
      },
    ];

    configs.forEach((cfg) => {
      const sel = $(cfg.id);
      if (!sel) return;
      if (sel.closest(".vsc-po-filterwrap")) return;

      const wrap = document.createElement("span");
      wrap.className = "vsc-po-filterwrap";
      sel.parentNode.insertBefore(wrap, sel);
      wrap.appendChild(sel);

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "vsc-po-filterclear";
      btn.setAttribute("aria-label", "Limpiar filtro");
      btn.innerHTML = "&times;";
      wrap.appendChild(btn);

      const update = () => {
        const active = !!cfg.isActive(sel);
        btn.style.display = active ? "inline-flex" : "none";
      };

      btn.addEventListener("click", (e) => {
        e.preventDefault();
        cfg.onClear(sel);
        update();
      });

      sel.addEventListener("change", update);
      update();
    });
  }

  function toast(msg, type = "ok") {
    const el = $("vscPoToast");
    el.textContent = msg;
    el.className = "vsc-po-toast vsc-po-toast--" + type;
    el.style.display = "block";
    clearTimeout(el._t);
    el._t = setTimeout(() => {
      el.style.display = "none";
    }, 3500);
  }

  async function api(path, opts = {}) {
    const url = VSC_PO.restUrl.replace(/\/$/, "") + path;
    const headers = Object.assign(
      {
        "X-WP-Nonce": VSC_PO.nonce,
        "Content-Type": "application/json",
      },
      opts.headers || {},
    );

    try {
      const res = await fetch(url, Object.assign({}, opts, { headers }));
      const txt = await res.text();
      let data = null;
      try {
        data = txt ? JSON.parse(txt) : null;
      } catch (e) {}

      if (!res.ok) {
        const msg =
          data && (data.error || data.message)
            ? data.error || data.message
            : "Error " + res.status;
        throw new Error(msg);
      }
      return data;
    } catch (error) {
      throw new Error("Error de conexión: " + error.message);
    }
  }

  function money(v) {
    if (v === null || v === undefined || v === "") return "";
    const n = Number(v);
    if (!Number.isFinite(n)) return "";
    return n.toFixed(2).replace(/\.00$/, "");
  }

  function stockLabel(s) {
    switch (s) {
      case "pending":
        return "Pendiente";
      case "out":
        return "Sin stock";
      case "low":
        return "Bajo mínimo";
      case "good":
        return "Buen stock";
      default:
        return "";
    }
  }

  function rowClass(item) {
    return "vsc-po-row vsc-po-row--" + item.stock_status;
  }

  function canSelect(item) {
    return (
      item.manage_stock && item.min_stock !== null && item.has_valid_supplier
    );
  }

  function renderPagination(containerId) {
    const el = $(containerId);
    if (!el) return;

    const pages = Math.max(1, Math.ceil(state.total / state.per_page));
    const p = state.page;

    el.innerHTML = "";
    if (pages <= 1) return;

    const wrap = document.createElement("div");
    wrap.className = "vsc-po-pager";

    const prev = document.createElement("button");
    prev.className = "vsc-po-btn";
    prev.textContent = "← Anterior";
    prev.disabled = p <= 1;
    prev.onclick = () => {
      state.page = Math.max(1, p - 1);
      loadItems();
    };

    const next = document.createElement("button");
    next.className = "vsc-po-btn";
    next.textContent = "Siguiente →";
    next.disabled = p >= pages;
    next.onclick = () => {
      state.page = Math.min(pages, p + 1);
      loadItems();
    };

    const info = document.createElement("div");
    info.className = "vsc-po-pager__info";
    info.textContent = `Página ${p} de ${pages} | Total: ${state.total}`;

    wrap.appendChild(prev);
    wrap.appendChild(info);
    wrap.appendChild(next);
    el.appendChild(wrap);
  }

  function renderTable() {
    const tbody = $("vscPoTbody");
    if (!tbody) return;

    if (state.items.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="11" class="vsc-po-loading">No se encontraron productos con los filtros actuales.</td></tr>';
      renderPagination("vscPoPaginationTop");
      renderPagination("vscPoPaginationBottom");
      updateStats();
      return;
    }

    tbody.innerHTML = "";

    state.items.forEach((item) => {
      const dirtyPatch = state.dirtyInventory.get(item.id) || {};
      const tr = document.createElement("tr");
      tr.className = rowClass(item);

      // select
      const tdSel = document.createElement("td");
      tdSel.className = "vsc-po-col--select";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = state.select.has(item.id);
      cb.disabled = !canSelect(item);
      cb.title = canSelect(item)
        ? "Seleccionar para pedido"
        : "Requiere stock mínimo y proveedor válido";
      cb.onchange = () => {
        if (cb.checked) state.select.add(item.id);
        else state.select.delete(item.id);
        updateStats();
      };
      tdSel.appendChild(cb);
      tr.appendChild(tdSel);

      // img
      const tdImg = document.createElement("td");
      tdImg.innerHTML = item.img
        ? `<img src="${item.img}" class="vsc-po-thumb" alt="${item.name}" />`
        : '<div class="vsc-po-thumb"></div>';
      tr.appendChild(tdImg);

      // sku
      const tdSku = document.createElement("td");
      tdSku.textContent = item.sku || "-";
      tr.appendChild(tdSku);

      // name
      const tdName = document.createElement("td");
      tdName.textContent = item.name || "";
      tr.appendChild(tdName);

      // stock current
      const tdStock = document.createElement("td");
      tdStock.className = "vsc-po-col--num vsc-po-stockcell";
      tdStock.classList.add(
        "vsc-po-stockcell--" + (item.stock_status || "pending"),
      );
      tdStock.title = stockLabel(item.stock_status);
      tdStock.textContent =
        item.stock_quantity === null ? "-" : item.stock_quantity;
      tr.appendChild(tdStock);

      // edit toggle
      const tdEdit = document.createElement("td");
      tdEdit.className = "vsc-po-col--toggle";
      const editCb = document.createElement("input");
      editCb.type = "checkbox";
      editCb.checked = state.editStockEnabled.has(item.id);
      editCb.title = "Editar stock";
      editCb.onchange = () => {
        if (editCb.checked) state.editStockEnabled.add(item.id);
        else state.editStockEnabled.delete(item.id);
        renderTable();
      };
      tdEdit.appendChild(editCb);
      tr.appendChild(tdEdit);

      // new stock input
      const tdNewStock = document.createElement("td");
      tdNewStock.className = "vsc-po-col--num";
      const inpQty = document.createElement("input");
      inpQty.type = "number";
      inpQty.className = "vsc-po-input vsc-po-input--num";
      inpQty.value = item.stock_quantity === null ? "" : item.stock_quantity;
      inpQty.min = "0";
      inpQty.disabled =
        !state.editStockEnabled.has(item.id) || !item.manage_stock;
      inpQty.placeholder = "-";
      if (Object.prototype.hasOwnProperty.call(dirtyPatch, "stock_quantity")) {
        inpQty.classList.add("vsc-po-input--dirty");
      }
      inpQty.oninput = () => {
        const value =
          inpQty.value === "" ? null : Math.max(0, parseInt(inpQty.value) || 0);
        markDirty(item.id, { stock_quantity: value });
        const dpQty = state.dirtyInventory.get(item.id) || {};
        if (Object.prototype.hasOwnProperty.call(dpQty, "stock_quantity"))
          inpQty.classList.add("vsc-po-input--dirty");
        else inpQty.classList.remove("vsc-po-input--dirty");
        item.stock_quantity = value;
        item.stock_status = computeClientStatus(item);
        tdStock.textContent = value === null ? "-" : value;
        tdStock.className = "vsc-po-col--num vsc-po-stockcell";
        tdStock.classList.add(
          "vsc-po-stockcell--" + (item.stock_status || "pending"),
        );
      };
      tdNewStock.appendChild(inpQty);
      tr.appendChild(tdNewStock);

      // manage stock
      const tdManage = document.createElement("td");
      tdManage.className = "vsc-po-col--toggle";
      const ms = document.createElement("input");
      ms.type = "checkbox";
      ms.checked = !!item.manage_stock;
      ms.title = "Gestionar stock";
      ms.onchange = () => {
        const newVal = ms.checked;
        markDirty(item.id, { manage_stock: newVal });
        if (!newVal) {
          state.editStockEnabled.delete(item.id);
          item.stock_quantity = null;
        }
        item.manage_stock = newVal;
        item.stock_status = computeClientStatus(item);
        renderTable();
      };
      tdManage.appendChild(ms);
      tr.appendChild(tdManage);

      // min stock
      const tdMin = document.createElement("td");
      tdMin.className = "vsc-po-col--num";
      const inpMin = document.createElement("input");
      inpMin.type = "number";
      inpMin.min = "0";
      inpMin.className = "vsc-po-input vsc-po-input--num";
      inpMin.value = item.min_stock === null ? "" : item.min_stock;
      inpMin.placeholder = "Obligatorio";
      if (Object.prototype.hasOwnProperty.call(dirtyPatch, "min_stock")) {
        inpMin.classList.add("vsc-po-input--dirty");
      }
      inpMin.oninput = () => {
        const value =
          inpMin.value === "" ? null : Math.max(0, parseInt(inpMin.value) || 0);
        markDirty(item.id, { min_stock: value });
        const dpMin = state.dirtyInventory.get(item.id) || {};
        if (Object.prototype.hasOwnProperty.call(dpMin, "min_stock"))
          inpMin.classList.add("vsc-po-input--dirty");
        else inpMin.classList.remove("vsc-po-input--dirty");
        item.min_stock = value;
        item.stock_status = computeClientStatus(item);
        tdStock.textContent =
          item.stock_quantity === null ? "-" : item.stock_quantity;
        tdStock.className = "vsc-po-col--num vsc-po-stockcell";
        tdStock.classList.add(
          "vsc-po-stockcell--" + (item.stock_status || "pending"),
        );
      };
      tdMin.appendChild(inpMin);
      tr.appendChild(tdMin);

      // proveedor
      const tdSup = document.createElement("td");

      if (
        item.has_valid_supplier &&
        Array.isArray(item.supplier_choices) &&
        item.supplier_choices.length
      ) {
        if (!item.current_supplier_id)
          item.current_supplier_id =
            item.best_supplier_id || item.supplier_choices[0].supplier_id;
        if (
          item.current_wholesale === undefined ||
          item.current_wholesale === null
        )
          item.current_wholesale = item.best_wholesale;

        const nameSpan = document.createElement("span");
        nameSpan.className = "vsc-po-suppliername";
        const supObj = state.suppliers.find(
          (s) => Number(s.id) === Number(item.current_supplier_id),
        );
        nameSpan.textContent = supObj
          ? supObj.name
          : "Proveedor " + item.current_supplier_id;

        const btn = document.createElement("button");
        btn.className = "vsc-po-btn vsc-po-btn--ghost vsc-po-btn--xs";
        btn.type = "button";
        btn.textContent = "Elegir";
        btn.onclick = () => openChooseSupplierModal(item);

        tdSup.appendChild(nameSpan);
        tdSup.appendChild(document.createTextNode(" "));
        tdSup.appendChild(btn);
      } else {
        const b = document.createElement("button");
        b.className = "vsc-po-btn vsc-po-btn--primary";
        b.textContent = "Asignar proveedor";
        b.onclick = () => openAssignModal(item);
        tdSup.appendChild(b);
      }
      tr.appendChild(tdSup);

      // mayorista
      const tdW = document.createElement("td");
      tdW.className = "vsc-po-col--num vsc-po-wholesale-cell";
      const initialWholesale =
        item.current_wholesale !== undefined && item.current_wholesale !== null
          ? item.current_wholesale
          : item.best_wholesale;
      tdW.textContent = initialWholesale ? "$" + money(initialWholesale) : "-";
      tr.appendChild(tdW);

      tbody.appendChild(tr);
    });

    // Update select all checkbox
    const selectAllCb = $("vscPoSelectAll");
    if (selectAllCb) {
      const selectableItems = state.items.filter((item) => canSelect(item));
      const allSelected =
        selectableItems.length > 0 &&
        selectableItems.every((item) => state.select.has(item.id));
      selectAllCb.checked = allSelected;
      selectAllCb.indeterminate =
        !allSelected &&
        selectableItems.some((item) => state.select.has(item.id));

      selectAllCb.onchange = () => {
        if (selectAllCb.checked) {
          selectableItems.forEach((item) => state.select.add(item.id));
        } else {
          selectableItems.forEach((item) => state.select.delete(item.id));
        }
        updateStats();
        renderTable();
      };
    }

    renderPagination("vscPoPaginationTop");
    renderPagination("vscPoPaginationBottom");
    updateStats();
  }

  function computeClientStatus(item) {
    if (
      !item.manage_stock ||
      item.min_stock === null ||
      item.stock_quantity === null
    )
      return "pending";
    if (Number(item.stock_quantity) === 0) return "out";
    if (Number(item.stock_quantity) <= Number(item.min_stock)) return "low";
    return "good";
  }

  function normInt(v) {
    if (v === "" || v === undefined) return null;
    if (v === null) return null;
    const n = Number.parseInt(String(v), 10);
    return Number.isFinite(n) ? n : null;
  }

  function setDirtyField(product_id, field, value) {
    // Ensure we have a baseline
    if (!state.originalInventory.has(product_id)) {
      const it = state.items.find((x) => x.id === product_id);
      state.originalInventory.set(product_id, {
        manage_stock: it ? !!it.manage_stock : false,
        stock_quantity: it ? normInt(it.stock_quantity) : null,
        min_stock: it ? normInt(it.min_stock) : null,
      });
    }

    const base = state.originalInventory.get(product_id);
    const baseVal =
      field === "manage_stock" ? !!base.manage_stock : normInt(base[field]);
    const nextVal = field === "manage_stock" ? !!value : normInt(value);

    const prevPatch = state.dirtyInventory.get(product_id) || {};
    const patch = Object.assign({}, prevPatch);

    const isDifferent = nextVal !== baseVal;

    if (isDifferent) {
      patch[field] = nextVal;
    } else {
      delete patch[field];
    }

    if (Object.keys(patch).length === 0) {
      state.dirtyInventory.delete(product_id);
    } else {
      state.dirtyInventory.set(product_id, patch);
    }
    updateStats();
  }

  function markDirty(product_id, patch) {
    Object.keys(patch || {}).forEach((k) => {
      setDirtyField(product_id, k, patch[k]);
    });
  }

  async function loadCategories() {
    try {
      const data = await api("/categories", { method: "GET" });
      state.categories = data.categories || [];

      const sel = $("vscPoCategory");
      sel.innerHTML = "";

      const ph = document.createElement("option");
      ph.value = "";
      ph.textContent = "Filtrar por categoría";
      ph.disabled = true;
      ph.hidden = true;
      sel.appendChild(ph);

      state.categories.forEach((c) => {
        const opt = document.createElement("option");
        opt.value = String(c.id);
        opt.textContent = `${c.name} (${c.count})`;
        sel.appendChild(opt);
      });

      if (state.category) sel.value = state.category;
      else sel.value = "";
    } catch (error) {
      console.error("Error loading categories:", error);
      toast("Error cargando categorías", "err");
    }
  }

  async function loadSuppliers() {
    try {
      const data = await api("/suppliers", { method: "GET" });
      state.suppliers = data.suppliers || [];
      renderSupplierFilter();
    } catch (error) {
      console.error("Error loading suppliers:", error);
      state.suppliers = [];
      renderSupplierFilter();
    }
  }

  function renderSupplierFilter() {
    const wrap = $("vscPoSupplierFilter");
    const btn = $("vscPoSupplierBtn");
    const panel = $("vscPoSupplierPanel");
    if (!wrap || !btn || !panel) return;

    // Normaliza selección
    const uniq = Array.from(
      new Set(
        (state.supplier_ids || []).map((n) => Number(n)).filter((n) => n > 0),
      ),
    );
    state.supplier_ids = uniq;

    const getLabel = () => {
      if (!state.suppliers || state.suppliers.length === 0)
        return "Filtrar por proveedores";
      if (state.supplier_ids.length === 0) return "Filtrar por proveedores";
      if (state.supplier_ids.length === 1) {
        const s = state.suppliers.find(
          (x) => Number(x.id) === Number(state.supplier_ids[0]),
        );
        return s ? s.name : "Filtrar por proveedores";
      }
      return `Proveedores (${state.supplier_ids.length})`;
    };

    btn.textContent = getLabel();

    panel.innerHTML = "";
    if (!state.suppliers || state.suppliers.length === 0) {
      panel.innerHTML =
        '<div class="vsc-po-multiselect__empty">No hay proveedores</div>';
      return;
    }

    state.suppliers.forEach((s) => {
      const row = document.createElement("label");
      row.className = "vsc-po-multiselect__option";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.value = String(s.id);
      cb.checked = state.supplier_ids.includes(Number(s.id));
      cb.addEventListener("change", () => {
        const id = Number(s.id);
        if (cb.checked) {
          if (!state.supplier_ids.includes(id)) state.supplier_ids.push(id);
        } else {
          state.supplier_ids = state.supplier_ids.filter(
            (x) => Number(x) !== id,
          );
        }
        // aplicar filtro inmediatamente
        state.page = 1;
        renderSupplierFilter();
        loadItems();
      });
      const span = document.createElement("span");
      span.textContent = s.name;
      row.appendChild(cb);
      row.appendChild(span);
      panel.appendChild(row);
    });

    // Estado aria
    panel.setAttribute(
      "aria-hidden",
      wrap.classList.contains("is-open") ? "false" : "true",
    );
  }

  async function loadItems() {
    showLoading("Cargando productos...");
    try {
      const params = new URLSearchParams();
      params.set("page", String(state.page));
      params.set("per_page", String(state.per_page));
      if (state.search) params.set("search", state.search);
      if (state.category) params.set("category", state.category);
      if (state.stock) params.set("stock", state.stock);
      if (Array.isArray(state.supplier_ids) && state.supplier_ids.length > 0) {
        state.supplier_ids.forEach((sid) => {
          if (Number(sid) > 0) params.append("supplier_ids[]", String(sid));
        });
      }

      const data = await api("/items?" + params.toString(), { method: "GET" });
      state.items = (data.items || []).map((it) => {
        it.stock_status = computeClientStatus(it);
        if (
          it.current_supplier_id === undefined ||
          it.current_supplier_id === null
        )
          it.current_supplier_id = it.best_supplier_id;
        if (it.current_wholesale === undefined || it.current_wholesale === null)
          it.current_wholesale = it.best_wholesale;
        return it;
      });

      // Init baseline values (for immediate dirty detection + revert to original)
      state.items.forEach((it) => {
        if (!state.originalInventory.has(it.id)) {
          state.originalInventory.set(it.id, {
            manage_stock: !!it.manage_stock,
            stock_quantity:
              it.stock_quantity === null || it.stock_quantity === undefined
                ? null
                : Number(it.stock_quantity),
            min_stock:
              it.min_stock === null || it.min_stock === undefined
                ? null
                : Number(it.min_stock),
          });
        }
      });

      state.total = data.total || 0;
      renderTable();
      toast(`Cargados ${state.items.length} productos`, "ok");
    } catch (error) {
      console.error("Error loading items:", error);
      toast(error.message, "err");
      state.items = [];
      state.total = 0;
      renderTable();
    } finally {
      hideLoading();
    }
  }

  async function saveInventory() {
    if (state.dirtyInventory.size === 0) {
      toast("No hay cambios de inventario para guardar.", "info");
      return;
    }

    showLoading("Guardando cambios...");
    const updates = [];
    state.dirtyInventory.forEach((patch, pid) => {
      updates.push(Object.assign({ product_id: pid }, patch));
    });

    try {
      const data = await api("/inventory/bulk", {
        method: "POST",
        body: JSON.stringify({ updates }),
      });
      toast(
        `Cambios guardados: ${data.updated.length} productos actualizados.`,
        "ok",
      );
      state.dirtyInventory.clear();

      const byId = new Map((data.updated || []).map((u) => [u.product_id, u]));
      state.items = state.items.map((it) => {
        const u = byId.get(it.id);
        if (!u) return it;
        return Object.assign({}, it, {
          manage_stock: u.manage_stock,
          stock_quantity: u.stock_quantity,
          min_stock: u.min_stock,
          stock_status: u.stock_status,
        });
      });

      // Update baseline so "dirty" compares against the newly saved values
      state.items.forEach((it) => {
        state.originalInventory.set(it.id, {
          manage_stock: !!it.manage_stock,
          stock_quantity:
            it.stock_quantity === null || it.stock_quantity === undefined
              ? null
              : Number(it.stock_quantity),
          min_stock:
            it.min_stock === null || it.min_stock === undefined
              ? null
              : Number(it.min_stock),
        });
      });
      renderTable();
    } catch (error) {
      toast(error.message, "err");
    } finally {
      hideLoading();
    }
  }

  async function openChooseSupplierModal(item) {
    state.modal.open = true;
    state.modal.product_id = item.id;
    state.modal.mode = "choose";
    $("vscPoModalTitle").textContent = "Elegir proveedor";
    $("vscPoModal").setAttribute("aria-hidden", "false");

    try {
      if (
        !Array.isArray(item.supplier_choices) ||
        item.supplier_choices.length === 0
      ) {
        item.supplier_choices = await fetchValidSuppliers(item.id);
      }

      const body = $("vscPoModalBody");
      body.innerHTML = "";

      const p = document.createElement("div");
      p.className = "vsc-po-modal__text";
      p.textContent = `Producto: ${item.sku ? item.sku + " — " : ""}${item.name}`;
      body.appendChild(p);

      const row = document.createElement("div");
      row.className = "vsc-po-formrow";

      const sel = document.createElement("select");
      sel.className = "vsc-po-select";
      sel.id = "vscPoModalChooseSupplier";

      item.supplier_choices.forEach((ch) => {
        const o = document.createElement("option");
        o.value = String(ch.supplier_id);
        o.textContent = `${ch.name} - $${money(ch.wholesale_cost)}`;
        sel.appendChild(o);
      });

      sel.value = String(
        item.current_supplier_id ||
          item.best_supplier_id ||
          item.supplier_choices[0].supplier_id,
      );
      row.appendChild(sel);
      body.appendChild(row);
    } catch (error) {
      toast(error.message, "err");
      closeModal();
    }
  }

  function openAssignModal(item) {
    state.modal.mode = "assign";
    $("vscPoModalTitle").textContent = "Asignar proveedor";
    state.modal.open = true;
    state.modal.product_id = item.id;
    $("vscPoModal").setAttribute("aria-hidden", "false");

    const body = $("vscPoModalBody");
    body.innerHTML = "";
    const p = document.createElement("div");
    p.className = "vsc-po-modal__text";
    p.textContent = `Producto: ${item.sku ? item.sku + " — " : ""}${item.name}`;
    body.appendChild(p);

    const row = document.createElement("div");
    row.className = "vsc-po-formrow";

    const sel = document.createElement("select");
    sel.className = "vsc-po-select";
    sel.id = "vscPoModalSupplier";
    const opt0 = document.createElement("option");
    opt0.value = "";
    opt0.textContent = "Selecciona proveedor";
    sel.appendChild(opt0);
    state.suppliers.forEach((s) => {
      const o = document.createElement("option");
      o.value = String(s.id);
      o.textContent = s.name;
      sel.appendChild(o);
    });

    const inp = document.createElement("input");
    inp.className = "vsc-po-input vsc-po-input--num";
    inp.type = "number";
    inp.min = "0.01";
    inp.step = "0.01";
    inp.id = "vscPoModalWholesale";
    inp.placeholder = "Precio mayorista (obligatorio)";

    row.appendChild(sel);
    row.appendChild(inp);
    body.appendChild(row);

    // Exigir SKU solo si el producto NO tiene SKU (y está en modo asignación porque no tiene proveedor válido)
    if (!item.sku) {
      const skuRow = document.createElement("div");
      skuRow.className = "vsc-po-formrow";

      const skuInp = document.createElement("input");
      skuInp.className = "vsc-po-input";
      skuInp.type = "text";
      skuInp.id = "vscPoModalSku";
      skuInp.placeholder = "SKU (obligatorio)";
      skuInp.autocomplete = "off";
      skuInp.maxLength = 190;

      skuRow.appendChild(skuInp);
      body.appendChild(skuRow);
    }
  }

  function closeModal() {
    state.modal.open = false;
    state.modal.product_id = null;
    $("vscPoModal").setAttribute("aria-hidden", "true");
  }

  async function saveAssignModal() {
    showLoading("Guardando proveedor...");

    try {
      if (state.modal.mode === "choose") {
        const pid = state.modal.product_id;
        const sid = Number(
          $("vscPoModalChooseSupplier") && $("vscPoModalChooseSupplier").value
            ? $("vscPoModalChooseSupplier").value
            : 0,
        );
        if (!pid || !sid) {
          toast("Selecciona un proveedor.", "err");
          return;
        }

        state.items = state.items.map((it) => {
          if (it.id !== pid) return it;
          const chosen = Array.isArray(it.supplier_choices)
            ? it.supplier_choices.find((x) => Number(x.supplier_id) === sid)
            : null;
          return Object.assign({}, it, {
            current_supplier_id: sid,
            current_wholesale: chosen
              ? Number(chosen.wholesale_cost)
              : it.best_wholesale,
          });
        });

        toast("Proveedor actualizado.", "ok");
        closeModal();
        renderTable();

        if (state.orders && state.orders.length) {
          generateOrders();
        }
      } else {
        // mode = assign
        const pid = state.modal.product_id;
        const sid = Number($("vscPoModalSupplier").value || 0);
        const w = $("vscPoModalWholesale").value;
        const skuEl = $("vscPoModalSku");
        const sku = skuEl ? String(skuEl.value || "").trim() : "";

        if (!sid || !w || parseFloat(w) <= 0) {
          toast("Selecciona proveedor y precio mayorista válido.", "err");
          return;
        }

        // Si el campo SKU está visible, es obligatorio
        if (skuEl && !sku) {
          toast("Debes colocar un SKU para poder asignar el proveedor.", "err");
          skuEl.focus();
          return;
        }

        const data = await api("/assign-supplier", {
          method: "POST",
          body: JSON.stringify({
            product_id: pid,
            supplier_id: sid,
            wholesale_cost: w,
            sku: skuEl ? sku : undefined,
          }),
        });

        state.items = state.items.map((it) => {
          if (it.id !== pid) return it;
          return Object.assign({}, it, {
            has_valid_supplier: true,
            sku: data && data.sku ? data.sku : it.sku,
            best_supplier_id: data.best_supplier_id,
            best_wholesale: data.best_wholesale,
            supplier_choices:
              data.supplier_choices || it.supplier_choices || [],
            current_supplier_id: data.best_supplier_id,
            current_wholesale: data.best_wholesale,
          });
        });

        toast("Proveedor asignado correctamente.", "ok");
        closeModal();
        renderTable();
      }
    } catch (error) {
      toast(error.message, "err");
    } finally {
      hideLoading();
    }
  }

  async function generateOrders() {
    const selected = state.items.filter((it) => state.select.has(it.id));
    if (selected.length === 0) {
      toast("Selecciona al menos un producto para generar el pedido.", "info");
      return;
    }

    const invalid = selected.find((it) => !canSelect(it));
    if (invalid) {
      toast(
        "Hay productos seleccionados que no cumplen requisitos (stock mínimo y proveedor válido).",
        "err",
      );
      return;
    }

    showLoading("Generando pedido...");

    const bySupplier = new Map();
    selected.forEach((it) => {
      const sid = it.current_supplier_id || it.best_supplier_id;
      if (!sid) return;
      if (!bySupplier.has(sid)) bySupplier.set(sid, []);
      bySupplier.get(sid).push({
        product_id: it.id,
        sku: it.sku,
        name: it.name,
        wholesale_cost:
          it.current_wholesale !== undefined && it.current_wholesale !== null
            ? it.current_wholesale
            : it.best_wholesale,
        quantity: 1,
        supplier_id: sid,
      });
    });

    state.orders = Array.from(bySupplier.entries()).map(([sid, items]) => {
      const sup = state.suppliers.find((s) => s.id === sid);
      return {
        supplier_id: sid,
        supplier_name: sup ? sup.name : "Proveedor " + sid,
        items,
      };
    });

    renderOrders();
    $("vscPoStep2").style.display = "block";
    toast(
      `Pedido generado con ${selected.length} productos en ${state.orders.length} proveedores.`,
      "ok",
    );
    hideLoading();
  }

  async function fetchValidSuppliers(product_id) {
    const data = await api(
      "/item-suppliers?product_id=" + encodeURIComponent(product_id),
      { method: "GET" },
    );
    return data.suppliers || [];
  }

  function renderOrders() {
    const wrap = $("vscPoOrders");
    const summary = $("vscPoOrdersSummary");

    if (!state.orders || state.orders.length === 0) {
      wrap.innerHTML =
        '<div class="vsc-po-muted">No hay pedido generado.</div>';
      if (summary) summary.textContent = "";
      return;
    }

    const totalItems = state.orders.reduce((sum, o) => sum + o.items.length, 0);
    const totalValue = state.orders.reduce(
      (sum, o) => sum + calcOrderTotal(o),
      0,
    );

    if (summary) {
      summary.textContent = `${state.orders.length} proveedores | ${totalItems} productos | Total: $${money(totalValue)}`;
    }

    wrap.innerHTML = "";

    state.orders.forEach((order) => {
      const card = document.createElement("div");
      card.className = "vsc-po-card";

      const head = document.createElement("div");
      head.className = "vsc-po-card__head";
      head.innerHTML = `<div class="vsc-po-card__title">${order.supplier_name}</div>
                        <div class="vsc-po-card__meta">${order.items.length} ítems | Total: $${money(calcOrderTotal(order))}</div>`;
      card.appendChild(head);

      const table = document.createElement("table");
      table.className = "vsc-po-table vsc-po-table--compact";
      table.innerHTML = `<thead>
          <tr>
            <th>SKU</th><th>Item</th><th class="vsc-po-col--num">Mayorista</th>
            <th>Proveedor</th>
            <th class="vsc-po-col--num">Cantidad</th>
            <th class="vsc-po-col--num">Subtotal</th>
          </tr>
        </thead>`;
      const tb = document.createElement("tbody");

      order.items.forEach((it) => {
        const tr = document.createElement("tr");

        const tdSku = document.createElement("td");
        tdSku.textContent = it.sku || "";
        const tdName = document.createElement("td");
        tdName.textContent = it.name || "";
        const tdW = document.createElement("td");
        tdW.className = "vsc-po-col--num";
        tdW.textContent = "$" + money(it.wholesale_cost);

        const tdSup = document.createElement("td");
        const sel = document.createElement("select");
        sel.className = "vsc-po-select";
        sel.innerHTML = `<option value="${it.supplier_id}">Cargando...</option>`;
        tdSup.appendChild(sel);

        fetchValidSuppliers(it.product_id)
          .then((list) => {
            sel.innerHTML = "";
            list.forEach((s) => {
              const o = document.createElement("option");
              o.value = String(s.supplier_id);
              o.textContent = `${s.name} (${money(s.wholesale_cost)}$)`;
              if (s.supplier_id === it.supplier_id) o.selected = true;
              sel.appendChild(o);
            });
          })
          .catch(() => {
            sel.innerHTML = `<option value="${it.supplier_id}">Proveedor ${it.supplier_id}</option>`;
          });

        sel.onchange = async () => {
          const newSid = Number(sel.value);
          const list = await fetchValidSuppliers(it.product_id);
          const chosen = list.find((x) => x.supplier_id === newSid);
          if (chosen) {
            it.supplier_id = newSid;
            it.wholesale_cost = chosen.wholesale_cost;
            moveItemToSupplier(
              it.product_id,
              order.supplier_id,
              newSid,
              chosen,
            );
          }
        };

        const tdQty = document.createElement("td");
        tdQty.className = "vsc-po-col--num";
        const inp = document.createElement("input");
        inp.type = "number";
        inp.min = "1";
        inp.step = "1";
        inp.className = "vsc-po-input vsc-po-input--num";
        inp.value = String(it.quantity || 1);
        inp.oninput = () => {
          it.quantity = Math.max(1, Number(inp.value || 1));
          tdSub.textContent = "$" + money(it.quantity * it.wholesale_cost);
          renderOrderTotals();
        };
        tdQty.appendChild(inp);

        const tdSub = document.createElement("td");
        tdSub.className = "vsc-po-col--num";
        tdSub.textContent = "$" + money(it.quantity * it.wholesale_cost);

        tr.appendChild(tdSku);
        tr.appendChild(tdName);
        tr.appendChild(tdW);
        tr.appendChild(tdSup);
        tr.appendChild(tdQty);
        tr.appendChild(tdSub);
        tb.appendChild(tr);
      });

      table.appendChild(tb);
      card.appendChild(table);

      const foot = document.createElement("div");
      foot.className = "vsc-po-card__foot";
      const total = document.createElement("div");
      total.className = "vsc-po-total";
      total.dataset.supplierId = String(order.supplier_id);
      total.textContent = "Total: $" + money(calcOrderTotal(order));
      const exp = document.createElement("button");
      exp.className = "vsc-po-btn vsc-po-btn--primary";
      exp.textContent = "Exportar CSV";
      exp.onclick = () => exportCsvSupplier(order.supplier_id);

      foot.appendChild(total);
      foot.appendChild(exp);
      card.appendChild(foot);

      wrap.appendChild(card);
    });
  }

  function calcOrderTotal(order) {
    return (order.items || []).reduce(
      (sum, it) =>
        sum + Number(it.quantity || 1) * Number(it.wholesale_cost || 0),
      0,
    );
  }

  function renderOrderTotals() {
    if (!state.orders) return;
    state.orders.forEach((o) => {
      const el = document.querySelector(
        `.vsc-po-total[data-supplier-id="${o.supplier_id}"]`,
      );
      if (el) el.textContent = "Total: $" + money(calcOrderTotal(o));
    });

    const summary = $("vscPoOrdersSummary");
    if (summary && state.orders.length > 0) {
      const totalItems = state.orders.reduce(
        (sum, o) => sum + o.items.length,
        0,
      );
      const totalValue = state.orders.reduce(
        (sum, o) => sum + calcOrderTotal(o),
        0,
      );
      summary.textContent = `${state.orders.length} proveedores | ${totalItems} productos | Total: $${money(totalValue)}`;
    }
  }

  function moveItemToSupplier(product_id, fromSupplier, toSupplier, chosen) {
    if (!state.orders) return;
    const from = state.orders.find((o) => o.supplier_id === fromSupplier);
    if (!from) return;
    const idx = from.items.findIndex((x) => x.product_id === product_id);
    if (idx === -1) return;
    const item = from.items.splice(idx, 1)[0];
    item.supplier_id = toSupplier;
    item.wholesale_cost = chosen.wholesale_cost;

    let to = state.orders.find((o) => o.supplier_id === toSupplier);
    if (!to) {
      const sup = state.suppliers.find((s) => s.id === toSupplier);
      to = {
        supplier_id: toSupplier,
        supplier_name: sup ? sup.name : "Proveedor " + toSupplier,
        items: [],
      };
      state.orders.push(to);
    }
    to.items.push(item);

    if (from.items.length === 0) {
      state.orders = state.orders.filter((o) => o.supplier_id !== fromSupplier);
    }
    renderOrders();
  }

  function csvEscape(v) {
    const s = String(v ?? "");
    if (/[,"\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function exportCsvSupplier(supplier_id) {
    if (!state.orders) return;
    const order = state.orders.find((o) => o.supplier_id === supplier_id);
    if (!order) return;

    const rows = [];
    rows.push(["Proveedor", order.supplier_name]);
    rows.push(["Fecha", new Date().toLocaleDateString("es-ES")]);
    rows.push([]);
    rows.push(["SKU", "Producto", "Precio Mayorista", "Cantidad", "Subtotal"]);

    order.items.forEach((it) => {
      rows.push([
        it.sku,
        it.name,
        money(it.wholesale_cost),
        it.quantity,
        money(it.quantity * it.wholesale_cost),
      ]);
    });

    rows.push([]);
    rows.push(["", "", "", "Total", money(calcOrderTotal(order))]);

    const csv = rows.map((r) => r.map(csvEscape).join(",")).join("\n");
    download(
      "pedido_" + order.supplier_name.replace(/[^a-z0-9]/gi, "_") + ".csv",
      csv,
    );
  }

  function exportCsvAll() {
    if (!state.orders) return;

    const rows = [];
    rows.push(["Pedido de Compra - Vilma Skincare"]);
    rows.push(["Fecha", new Date().toLocaleDateString("es-ES")]);
    rows.push(["Total proveedores", state.orders.length]);
    rows.push([]);
    rows.push([
      "Proveedor",
      "SKU",
      "Producto",
      "Precio Mayorista",
      "Cantidad",
      "Subtotal",
    ]);

    state.orders.forEach((order) => {
      order.items.forEach((it) => {
        rows.push([
          order.supplier_name,
          it.sku,
          it.name,
          money(it.wholesale_cost),
          it.quantity,
          money(it.quantity * it.wholesale_cost),
        ]);
      });
    });

    rows.push([]);
    const totalValue = state.orders.reduce(
      (sum, o) => sum + calcOrderTotal(o),
      0,
    );
    rows.push(["", "", "", "", "Total General", money(totalValue)]);

    const csv = rows.map((r) => r.map(csvEscape).join(",")).join("\n");
    download(
      "pedido_completo_" + new Date().toISOString().split("T")[0] + ".csv",
      csv,
    );
  }

  function download(filename, text) {
    const blob = new Blob([text], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast(`Archivo ${filename} descargado`, "ok");
  }

  function printSummary() {
    const printWindow = window.open("", "_blank");
    printWindow.document.write(`
      <html>
        <head>
          <title>Resumen de Pedido - Vilma Skincare</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 20px; }
            h1 { color: #333; }
            table { width: 100%; border-collapse: collapse; margin: 20px 0; }
            th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
            th { background-color: #f4f4f4; }
            .total { font-weight: bold; font-size: 1.2em; }
          </style>
        </head>
        <body>
          <h1>Resumen de Pedido</h1>
          <p>Fecha: ${new Date().toLocaleDateString("es-ES")}</p>
          ${
            state.orders
              ? state.orders
                  .map(
                    (order) => `
            <h2>${order.supplier_name}</h2>
            <table>
              <tr><th>SKU</th><th>Producto</th><th>Precio</th><th>Cantidad</th><th>Subtotal</th></tr>
              ${order.items
                .map(
                  (it) => `
                <tr>
                  <td>${it.sku || ""}</td>
                  <td>${it.name || ""}</td>
                  <td>$${money(it.wholesale_cost)}</td>
                  <td>${it.quantity}</td>
                  <td>$${money(it.quantity * it.wholesale_cost)}</td>
                </tr>
              `,
                )
                .join("")}
              <tr class="total">
                <td colspan="4">Total ${order.supplier_name}</td>
                <td>$${money(calcOrderTotal(order))}</td>
              </tr>
            </table>
          `,
                  )
                  .join("")
              : "<p>No hay pedido generado.</p>"
          }
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  }

  function clearFilters() {
    state.search = "";
    state.category = "";
    state.stock = "";
    state.supplier_ids = [];
    state.page = 1;

    $("vscPoSearch").value = "";
    $("vscPoCategory").value = "";
    $("vscPoStockFilter").value = "";
    renderSupplierFilter();
    updateStockFilterUI();

    loadItems();
    toast("Filtros limpiados", "info");
  }

  function clearOrder() {
    state.orders = null;
    state.select.clear();
    $("vscPoStep2").style.display = "none";
    renderTable();
    toast("Pedido limpiado", "info");
  }

  function bindUI() {
    const syncFiltersFromUI = () => {
      state.category = $("vscPoCategory").value;

      // Stock filter: allow explicit "Todos los productos" option.
      const stockSel = $("vscPoStockFilter");
      const stockVal = stockSel ? stockSel.value : "";
      if (stockVal === "all") {
        state.stock = "";
        if (stockSel) stockSel.value = "";
      } else {
        state.stock = stockVal;
      }

      state.per_page = Number($("vscPoPerPage").value || 20);
    };

    const applyFilters = () => {
      state.page = 1;
      syncFiltersFromUI();
      updateStockFilterUI();
      loadItems();
    };

    $("vscPoRefresh").onclick = () => {
      state.page = 1;
      state.search = $("vscPoSearch").value.trim();
      syncFiltersFromUI();
      updateStockFilterUI();
      loadItems();
    };

    $("vscPoSaveInventory").onclick = saveInventory;
    $("vscPoGenerate").onclick = generateOrders;
    $("vscPoExportAll").onclick = exportCsvAll;
    $("vscPoClearFilters").onclick = clearFilters;
    $("vscPoClearOrder").onclick = clearOrder;
    $("vscPoPrintSummary").onclick = printSummary;

    // modal events
    $("vscPoModalClose").onclick = closeModal;
    $("vscPoModalCancel").onclick = closeModal;
    $("vscPoModalSave").onclick = saveAssignModal;

    // Auto-aplicar filtros al cambiar selección
    $("vscPoCategory").addEventListener("change", applyFilters);

    $("vscPoStockFilter").addEventListener("change", () => {
      updateStockFilterUI();
      applyFilters();
    });

    // Multi-select proveedores: dropdown con checkboxes
    (function initSupplierMultiSelect() {
      const wrap = $("vscPoSupplierFilter");
      const btn = $("vscPoSupplierBtn");
      const panel = $("vscPoSupplierPanel");
      if (!wrap || !btn || !panel) return;

      const close = () => {
        wrap.classList.remove("is-open");
        panel.setAttribute("aria-hidden", "true");
      };

      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        wrap.classList.toggle("is-open");
        panel.setAttribute(
          "aria-hidden",
          wrap.classList.contains("is-open") ? "false" : "true",
        );
      });

      panel.addEventListener("click", (e) => e.stopPropagation());

      document.addEventListener("click", () => {
        if (wrap.classList.contains("is-open")) close();
      });

      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") close();
      });
    })();

    $("vscPoPerPage").addEventListener("change", () => {
      state.per_page = Number($("vscPoPerPage").value || 20);
      state.page = 1;
      loadItems();
    });

    // Enter key to search
    $("vscPoSearch").addEventListener("keydown", (e) => {
      if (e.key === "Enter") $("vscPoRefresh").click();
    });

    // Escape key to close modal
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && state.modal.open) {
        closeModal();
      }
    });
  }

  async function boot() {
    try {
      bindUI();
      updateStockFilterUI();
      showLoading("Inicializando módulo...");
      await Promise.all([loadCategories(), loadSuppliers()]);
      // Botones "X" para limpiar filtros individuales
      setupClearableFilters();
      await loadItems();
      toast("Módulo listo. Versión " + VSC_PO.version, "ok");
    } catch (e) {
      console.error("Boot error:", e);
      toast("Error inicializando módulo: " + e.message, "err");
    } finally {
      hideLoading();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
