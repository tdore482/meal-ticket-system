import sqlite3
import os

db_path = 'meal_system.db'

if not os.path.exists(db_path):
    print(f"❌ Database file {db_path} not found.")
    exit(1)

try:
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    print("🔄 Clearing user data and transactions (keeping vendors and admins)...\n")

    # Disable foreign keys temporarily if needed, but better to do it in order
    cursor.execute("PRAGMA foreign_keys = OFF;")

    tables_to_clear = [
        'transactions',
        'event_consumptions',
        'qr_tokens',
        'event_qr_tokens',
        'event_registrations',
        'meal_allocations',
        'sessions',
        'users'
    ]

    for table in tables_to_clear:
        try:
            cursor.execute(f"DELETE FROM {table}")
            print(f"✅ Cleared all entries from '{table}'")
        except sqlite3.OperationalError as e:
            print(f"⚠️ Could not clear table '{table}': {e}")

    conn.commit()

    # Verify counts
    print("\n--- Current Status ---")
    
    cursor.execute("SELECT COUNT(*) FROM vendors")
    print(f"🏢 Vendors remaining: {cursor.fetchone()[0]}")

    cursor.execute("SELECT COUNT(*) FROM admins")
    print(f"👤 Admins remaining: {cursor.fetchone()[0]}")

    cursor.execute("SELECT COUNT(*) FROM users")
    print(f"👥 Users remaining: {cursor.fetchone()[0]}")

    cursor.execute("SELECT COUNT(*) FROM transactions")
    print(f"📑 Transactions remaining: {cursor.fetchone()[0]}")

    cursor.execute("PRAGMA foreign_keys = ON;")
    conn.close()
    print("\n✨ Database cleanup complete! System is now fresh for new users.")

except Exception as e:
    print(f"❌ An error occurred: {e}")
