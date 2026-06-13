from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000"
USER = "admin"          # match ADMIN_USERNAME in .env.local
PASSWORD = "REPLACE"    # match ADMIN_PASSWORD in .env.local

def shoot(page, width, name):
    page.set_viewport_size({"width": width, "height": 900})
    page.wait_for_timeout(3500)  # let one poll tick land
    page.screenshot(path=name, full_page=True)
    print("saved", name)

with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page()
    page.goto(f"{BASE}/login")
    page.fill('input[name="username"]', USER)
    page.fill('input[name="password"]', PASSWORD)
    page.click('button[type="submit"]')
    page.wait_for_url(f"{BASE}/")
    shoot(page, 1280, "qa-dashboard-desktop.png")
    shoot(page, 390, "qa-dashboard-mobile.png")
    b.close()
