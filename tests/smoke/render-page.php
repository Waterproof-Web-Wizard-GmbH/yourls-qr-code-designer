<?php
// Renders the designer page with the YOURLS test install (see README, Development) for tests/smoke/admin-smoke.mjs.
define( 'YOURLS_ADMIN', true );
$_SERVER['HTTP_HOST'] = 'sho.rt'; $_SERVER['REQUEST_URI'] = '/admin/plugins.php';
require dirname( __DIR__, 2 ) . '/test-suite/YOURLS/includes/load-yourls.php';
require_once dirname( __DIR__, 2 ) . '/plugin.php';
WaterproofWebWizard\QrCodeDesigner\init();
yourls_add_filter( 'shunt_check_IP_flood', 'yourls_return_true' );
if ( !yourls_keyword_is_taken( 'smoke' ) ) yourls_add_new_link( 'https://example.com/smoke', 'smoke', 'Smoke <b>test</b>' );
$_GET['k'] = 'smoke';
ob_start(); WaterproofWebWizard\QrCodeDesigner\render_page(); $page = ob_get_clean();
ob_start(); WaterproofWebWizard\QrCodeDesigner\head( 'plugin_page_qr_code_designer' ); $head = ob_get_clean();
file_put_contents( __DIR__ . '/page.html', "<!doctype html><html><head>$head</head><body>$page</body></html>" );
echo strlen( $page ), " bytes\n", $head;
