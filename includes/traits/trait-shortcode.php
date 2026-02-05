<?php
if (!defined('ABSPATH')) { exit; }

trait VSC_PO_Trait_Shortcode {
    public static function register_shortcode() {
            add_shortcode('vilma_purchase_orders', [__CLASS__, 'render_shortcode']);
        }

    public static function register_assets() {
            $css_path = plugin_dir_path(VSC_PO_ADDON_FILE) . 'assets/po.css';
            $js_path  = plugin_dir_path(VSC_PO_ADDON_FILE) . 'assets/po.js';

            $css_ver = file_exists($css_path) ? filemtime($css_path) : self::PLUGIN_VERSION;
            $js_ver  = file_exists($js_path)  ? filemtime($js_path)  : self::PLUGIN_VERSION;

            wp_register_style('vsc-po-addon', plugins_url('assets/po.css', VSC_PO_ADDON_FILE), [], $css_ver);
            wp_register_script('vsc-po-addon', plugins_url('assets/po.js', VSC_PO_ADDON_FILE), ['wp-api-fetch'], $js_ver, true);
        }
public static function render_shortcode($atts = []) {
            // Enqueue only when shortcode is used
            wp_enqueue_style('vsc-po-addon');
            wp_enqueue_script('vsc-po-addon');
    
            $settings = [
                'restUrl' => esc_url_raw(rest_url(self::REST_NS)),
                'nonce'   => wp_create_nonce(self::NONCE_ACTION),
                'isAdmin' => current_user_can('manage_woocommerce'),
                'version' => self::PLUGIN_VERSION,
            ];
            wp_add_inline_script('vsc-po-addon', 'window.VSC_PO = ' . wp_json_encode($settings) . ';', 'before');
    
            if (!current_user_can('manage_woocommerce')) {
                return '<div class="vsc-po-wrap"><div class="vsc-po-alert vsc-po-alert--error">No tienes permisos para usar este módulo.</div></div>';
            }
    
            if (!self::tables_exist()) {
                return '<div class="vsc-po-wrap"><div class="vsc-po-alert vsc-po-alert--warning">Las tablas de proveedores no están disponibles. Verifica que el plugin Vilma Supplier Compare esté activo.</div></div>';
            }
    
            ob_start();
            ?>
            <div class="vsc-po-wrap" id="vsc-po-app">
                <div class="vsc-po-toolbar">
                    <div class="vsc-po-version">VSC PO Addon v<?php echo esc_html(self::PLUGIN_VERSION); ?></div>
                    <div class="vsc-po-toolbar__left">
                        <input type="text" id="vscPoSearch" class="vsc-po-input" placeholder="Buscar por SKU o nombre (usa = para exacto)" />
                        <button class="vsc-po-btn" id="vscPoRefresh">Buscar</button>
                        <select id="vscPoCategory" class="vsc-po-select">
                            <option value="" selected disabled hidden>Cargando categorías...</option>
                        </select>
                        <select id="vscPoStockFilter" class="vsc-po-select vsc-po-stockfilter">
                            <option value="" selected disabled hidden>Filtrar por stock</option>
                            <option value="all">Todos los productos</option>
                            <option value="out">Sin stock</option>
                            <option value="low">Stock bajo</option>
                            <option value="good">Stock normal</option>
                            <option value="pending">Pendientes</option>
                        </select>
                        <div class="vsc-po-multiselect" id="vscPoSupplierFilter">
                            <button type="button" class="vsc-po-multiselect__btn" id="vscPoSupplierBtn">Cargando proveedores...</button>
                            <div class="vsc-po-multiselect__panel" id="vscPoSupplierPanel" aria-hidden="true"></div>
                        </div>
                        <select id="vscPoPerPage" class="vsc-po-select">
                            <option value="10">10</option>
                            <option value="20" selected>20</option>
                            <option value="50">50</option>
                            <option value="100">100</option>
                            <option value="200">200</option>
                        </select>
                        <span class="vsc-po-perpage-label">Número de elementos por página</span>
<button class="vsc-po-btn vsc-po-btn--secondary" id="vscPoClearFilters">Limpiar filtros</button>
                    </div>
                    <div class="vsc-po-toolbar__right">
                        <button class="vsc-po-btn vsc-po-btn--primary" id="vscPoSaveInventory">Guardar cambios</button>
                        <button class="vsc-po-btn vsc-po-btn--success" id="vscPoGenerate">Generar pedido</button>
                    </div>
                </div>
    
                <div class="vsc-po-stats-bar">
                    <span id="vscPoTotalItems">0 productos</span>
                    <span id="vscPoSelectedItems">0 seleccionados</span>
                    <span id="vscPoDirtyItems">0 cambios pendientes</span>
                </div>
    
                <div class="vsc-po-pagination" id="vscPoPaginationTop"></div>
    
                <div class="vsc-po-tablewrap">
                    <table class="vsc-po-table" id="vscPoTable">
                        <thead>
                            <tr>
                                <th class="vsc-po-col--select">
                                    <input type="checkbox" id="vscPoSelectAll" title="Seleccionar todos">
                                </th>
                                <th>Img</th>
                                <th>SKU</th>
                                <th>Item</th>
                                <th class="vsc-po-col--num">Stock</th>
                                <th class="vsc-po-col--toggle">Editar</th>
                                <th class="vsc-po-col--num">Nuevo stock</th>
                                <th class="vsc-po-col--toggle">Gestión inventario</th>
                                <th class="vsc-po-col--num">Stock mínimo</th>
                                <th>Proveedor</th>
                                <th class="vsc-po-col--num">Mayorista</th>
</tr>
                        </thead>
                        <tbody id="vscPoTbody">
                            <tr><td colspan="11" class="vsc-po-loading">Cargando productos...</td></tr>
                        </tbody>
                    </table>
                </div>
    
                <div class="vsc-po-pagination" id="vscPoPaginationBottom"></div>
    
                <div class="vsc-po-divider"></div>
    
                <div class="vsc-po-step2" id="vscPoStep2" style="display: none;">
                    <h3 class="vsc-po-h3">Pedido generado</h3>
                    <div class="vsc-po-orders-header">
                        <div class="vsc-po-orders-summary" id="vscPoOrdersSummary"></div>
                        <div class="vsc-po-orders-actions">
                            <button class="vsc-po-btn vsc-po-btn--secondary" id="vscPoClearOrder">Limpiar pedido</button>
                            <button class="vsc-po-btn vsc-po-btn--primary" id="vscPoExportAll">Exportar CSV (Todo)</button>
                            <button class="vsc-po-btn vsc-po-btn--success" id="vscPoPrintSummary">Imprimir resumen</button>
                        </div>
                    </div>
                    <div id="vscPoOrders"></div>
                </div>
    
                <div class="vsc-po-modal" id="vscPoModal" aria-hidden="true">
                    <div class="vsc-po-modal__dialog">
                        <div class="vsc-po-modal__header">
                            <div class="vsc-po-modal__title" id="vscPoModalTitle">Asignar proveedor</div>
                            <button class="vsc-po-modal__close" id="vscPoModalClose" type="button">&times;</button>
                        </div>
                        <div class="vsc-po-modal__body" id="vscPoModalBody"></div>
                        <div class="vsc-po-modal__footer">
                            <button class="vsc-po-btn" id="vscPoModalCancel">Cancelar</button>
                            <button class="vsc-po-btn vsc-po-btn--primary" id="vscPoModalSave">Guardar</button>
                        </div>
                    </div>
                </div>
    
                <div class="vsc-po-toast" id="vscPoToast"></div>
    
                <div class="vsc-po-loading-overlay" id="vscPoLoadingOverlay" style="display: none;">
                    <div class="vsc-po-spinner"></div>
                    <div class="vsc-po-loading-text" id="vscPoLoadingText">Procesando...</div>
                </div>
            </div>
            <?php
            return ob_get_clean();
        }
}
