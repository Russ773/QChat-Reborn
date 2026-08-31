# Step 1: Move Anope onto MySQL

Goal: NickServ accounts live in a MySQL database that the PHP site will share.
This is transparent to the chat's SASL login. Run everything on the Anope box.

> BACK UP FIRST. Stop nothing yet, just copy the current flatfile DB + config:
> ```bash
> cp ~/services/data/anope.db ~/anope.db.backup
> cp ~/services/conf/services.conf ~/services.conf.backup
> cp ~/services/conf/modules.example.conf ~/modules.example.conf.backup
> ```

## 0. Check Anope has MySQL support

Anope must have been built with MySQL. Check for the module:

```bash
find ~/services -iname '*mysql*'
```

If you see an `m_mysql.so` (or similar), you are good. If you get nothing, Anope
was built without MySQL and needs rebuilding with the client libs:

```bash
sudo apt-get install -y libmysqlclient-dev   # or default-libmysqlclient-dev
cd ~/anope-source     # wherever you built Anope from
./Config              # it should now detect MySQL
make && make install
```

## 1. Create the database and user

Via Virtualmin (Edit Databases -> create `qchat`, and a MySQL user), or CLI:

```bash
sudo mysql <<'SQL'
CREATE DATABASE IF NOT EXISTS qchat CHARACTER SET utf8mb4;
CREATE USER IF NOT EXISTS 'qchat'@'localhost' IDENTIFIED BY 'CHOOSE_A_STRONG_PASSWORD';
GRANT ALL PRIVILEGES ON qchat.* TO 'qchat'@'localhost';
FLUSH PRIVILEGES;
SQL
```

## 2. Apply the QChat app tables

Upload `web/schema.sql` (from the repo), then:

```bash
mysql -u qchat -p qchat < schema.sql
```

## 3. Point Anope at MySQL

In `conf/modules.example.conf`, find the MySQL section, uncomment it, and set:

```
module { name = "m_mysql" }

mysql
{
    name     = "mysql/main"
    database = "qchat"
    server   = "127.0.0.1"
    port     = 3306
    username = "qchat"
    password = "CHOOSE_A_STRONG_PASSWORD"
}
```

(Match your version's exact block; the example file has the canonical syntax.)

## 4. Import the flatfile into MySQL (one time)

In `conf/services.conf`, enable the `db_sql` module and set `import = yes`. Keep
`db_flatfile` loaded for now so it has something to import from:

```
module
{
    name   = "db_sql"
    engine = "mysql/main"
    import = yes
}
```

Restart Anope and watch it import:

```bash
sudo systemctl restart anope
journalctl -u anope -n 40 --no-pager
```

Verify the accounts landed in MySQL (you should see your accounts, incl. Russ):

```bash
mysql -u qchat -p qchat -e "SELECT display, email FROM anope_db_NickCore;"
```

Also confirm services still work on IRC: NickServ responds and you can identify.

## 5. Switch to live mode

Now that the data is in MySQL, switch so external writes from PHP are picked up
in real time. In `conf/services.conf`:

- change `name = "db_sql"` to `name = "db_sql_live"`
- set `import = no`
- (optional) keep `db_flatfile` loaded AFTER it for a rolling file backup

Restart once more:

```bash
sudo systemctl restart anope
```

Done. NickServ now runs on MySQL, the chat login is unchanged, and the PHP site
(step 2 of the build) can read and write the same database.

### Rollback
If anything goes wrong, set `services.conf` back to `db_flatfile` only (remove
the db_sql block), restore `~/anope.db.backup` to `data/anope.db`, and restart.
```
