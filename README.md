# Jannik Sinner Calendar

Calendario iCalendar indipendente dedicato esclusivamente alle partite ufficialmente confermate di Jannik Sinner.

**Pagina tecnica:** [dizzle0987.github.io/jannik-sinner-calendar](https://dizzle0987.github.io/jannik-sinner-calendar)  
**Calendario:** [calendar.ics](https://dizzle0987.github.io/jannik-sinner-calendar/calendar.ics)

## Cosa contiene

- un unico URL iCalendar stabile;
- partite ufficialmente confermate della stagione corrente;
- torneo, categoria, turno, avversario, campo e superficie quando disponibili;
- risultati delle partite concluse;
- indicazione `Da confermare` quando un dato non è verificato;
- compatibilità con Apple Calendar, Google Calendar e Outlook.

Il calendario non include allenamenti, esibizioni, indiscrezioni, possibili turni futuri o partecipazioni non confermate.

## Sottoscrizione

Dalla pagina tecnica premi **Sottoscrivi il calendario**. In alternativa usa direttamente:

```text
https://dizzle0987.github.io/jannik-sinner-calendar/calendar.ics
```

- **Apple Calendar:** File → Nuova iscrizione calendario, quindi incolla l’URL.
- **Google Calendar:** Altri calendari → Da URL, quindi incolla l’URL.
- **Outlook:** Aggiungi calendario → Sottoscrivi dal Web, quindi incolla l’URL.

La sottoscrizione è preferibile al download: permette all’app calendario di ricevere gli aggiornamenti mantenendo lo stesso indirizzo.

## Fonti e criteri

Le informazioni pubblicate devono provenire prioritariamente da ATP Tour, siti ufficiali dei tornei, ordini di gioco e tabelloni ufficiali. Una partita viene inserita soltanto quando partecipazione, turno e avversario risultano confermati. Orario, campo e copertura televisiva restano `Da confermare` finché non sono supportati da una fonte ufficiale specifica.

Le partite attualmente presenti sono verificate tramite le pagine risultati e gli articoli ufficiali di ATP Tour.

## Struttura pubblica

- `index.html` — pagina tecnica minima che mantiene stabile il collegamento;
- `calendar.ics` — unico calendario sottoscrivibile;

## Avvertenze

Programmi, ordini di gioco e palinsesti possono cambiare anche con poco preavviso. Il progetto non inventa informazioni mancanti e non associa automaticamente un’emittente a una partita sulla sola base dei diritti generali di un torneo.

Questo è un progetto indipendente e non ufficiale. Jannik Sinner, il suo nome e gli altri marchi appartengono ai rispettivi titolari. Il progetto non implica approvazione o affiliazione.

## Licenza

Il codice originale del progetto è distribuito con licenza [MIT](LICENSE). La licenza MIT non concede diritti sui nomi o sugli altri marchi di terzi.
