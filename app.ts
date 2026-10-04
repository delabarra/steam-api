import { Hono } from 'hono'
import { pool } from './lib/db'

type Game = {
    appid: number
    name: string
}

const MAX_SEARCH_LENGTH = 100
const MAX_APPID = 2147483647

const query = async (text: string, values?: unknown[]) =>
    (await pool.query<Game>(text, values)).rows

// Treat % and _ in the search as literal characters in ILIKE patterns
const escapeLike = (value: string) => value.replace(/[\\%_]/g, '\\$&')

const app = new Hono()

app.get('/api/games', async (c) => {
    const search = c.req.query('search')?.slice(0, MAX_SEARCH_LENGTH)
    const pattern = search && escapeLike(search)
    let results: Game[] = []

    // If a number is coming in, search the appid
    const appid = Number(search)
    if (Number.isInteger(appid) && appid >= 0 && appid <= MAX_APPID) {
        results.push(
            ...(await query('SELECT * FROM "Game" WHERE appid = $1', [appid])),
        )
    }

    if (search && search.length > 2) {
        const games = await query(
            `
            (
                SELECT appid, name, 1 as score
                FROM public."Game"
                WHERE name ILIKE $2 || '%'
            )
            UNION ALL
            (
                SELECT appid, name, 0.99 as score
                FROM public."Game"
                WHERE name ILIKE '%' || $2 || '%'
            )
            UNION ALL
            (
                SELECT appid, name, similarity(name, $1) as score
                FROM public."Game"
                WHERE name % $1
            )
            order by score desc, name
            limit 100;
            `,
            [search, pattern],
        )
        results.push(...games)
    } else if (search?.length) {
        // Searching 1 or 2 chars do startswith type search
        results.push(
            ...(await query(
                `SELECT * FROM "Game" WHERE name ILIKE $1 || '%' LIMIT 100`,
                [pattern],
            )),
        )
    }

    // If no results, just return 30 random games
    if (results.length === 0 && !search?.length) {
        results = await query('SELECT * FROM "Game" ORDER BY RANDOM() LIMIT 30')
    }

    // filter out any duplicates that may have been returned
    results = results.filter(
        (item, index, self) =>
            self.findIndex((t) => t.appid === item.appid) === index,
    )

    return c.json(results)
})

app.all('/api/games', (c) => c.json([]))

export default app
