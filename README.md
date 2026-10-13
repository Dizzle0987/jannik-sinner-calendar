# Italian Tennis Calendar

Calendario iCalendar indipendente dedicato alle partite ufficialmente confermate dei principali tennisti italiani, uomini e donne.

**Pagina tecnica:** [dizzle0987.github.io/jannik-sinner-calendar](https://dizzle0987.github.io/jannik-sinner-calendar)  
**Calendario:** [calendar.ics](https://dizzle0987.github.io/jannik-sinner-calendar/calendar.ics)

## Cosa contiene

- un unico URL iCalendar stabile;
- partite ufficialmente confermate della stagione corrente per i principali giocatori italiani ATP e WTA;
- torneo, categoria, turno, avversario, campo e superficie quando disponibili;
- risultati delle partite concluse;
- indicazione `Da confermare` quando un dato non è verificato;
- compatibilità con Apple Calendar, Google Calendar e Outlook.

La selezione iniziale comprende Jannik Sinner, Flavio Cobolli, Lorenzo Musetti, Luciano Darderi, Matteo Arnaldi, Matteo Berrettini, Jasmine Paolini, Elisabetta Cocciaretto e Lucia Bronzetti. La rosa può cambiare seguendo le classifiche ufficiali ATP e WTA.

Gli eventi vengono pubblicati quando torneo e partecipazione sono confermati. Avversario, campo e orario vengono aggiunti appena compaiono nei tabelloni e negli ordini di gioco ufficiali; quando l'orario non è fisso, il calendario usa un evento giornaliero e lo spiega nella descrizione.

Per ogni appuntamento attuale viene indicata la copertura televisiva o streaming soltanto quando è confermata da una fonte specifica. Se non esiste una conferma verificabile, il calendario lo dichiara senza suggerire emittenti possibili.

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

## Aggiornamento automatico

Il repository esegue autonomamente un controllo ogni 15 minuti tramite GitHub Actions, così durante tornei e partite gli aggiornamenti arrivano rapidamente. Lo script interroga i tabelloni pubblici ATP e WTA disponibili sul servizio risultati ESPN, seleziona soltanto gli incontri dei giocatori seguiti, aggiorna orari e risultati mantenendo stabili gli UID iCalendar e pubblica una nuova versione solo quando i dati cambiano. Non sono richieste chiavi API, pianificazioni Codex o interventi manuali.

Gli incontri futuri con orario confermato includono un promemoria iCalendar due ore prima dell’inizio. Gli eventi ancora senza orario ricevono il promemoria automaticamente non appena l’orario viene confermato.

Sul sito sono sempre presenti tre riquadri, da sinistra a destra: incontri conclusi, incontri in corso e incontri in programma. Il riquadro dei conclusi mostra i due risultati più recenti e permette di aprire i precedenti con il pulsante “Vedi altri”; i riquadri live e futuri raccolgono tutti gli incontri della propria categoria.

L'automazione evita avversari indicati come `TBD`, valida il file `.ics` prima di ogni pubblicazione e si arresta in caso di errore della fonte invece di cancellare eventi esistenti.

Le indicazioni TV mostrano soltanto emittenti o piattaforme confermate per il torneo e includono il collegamento alla fonte. Se manca una conferma specifica, il sito e il calendario riportano “Copertura TV non confermata” senza suggerire canali possibili.

Il calendario conserva soltanto la stagione tennistica corrente e quelle future. La stagione non viene dedotta da una data fissa: per ogni torneo viene letto il campo ufficiale `season.year` pubblicato nel tabellone. Quando i tornei attivi passano alla nuova stagione, l’automazione elimina gli eventi della stagione terminata; la data dell’incontro viene usata soltanto come ripiego se la fonte non espone la stagione. Anche il riquadro dei risultati conclusi riparte senza incontri della vecchia stagione.

## Fonti e criteri

Le informazioni pubblicate devono provenire prioritariamente da ATP Tour, siti ufficiali dei tornei, ordini di gioco e tabelloni ufficiali. Una partita viene inserita soltanto quando partecipazione, turno e avversario risultano confermati. Orario, campo e copertura televisiva restano `Da confermare` finché non sono supportati da una fonte ufficiale specifica.

Le partite attualmente presenti sono verificate tramite le pagine risultati e gli articoli ufficiali di ATP Tour.

## Struttura pubblica

- `index.html` — pagina tecnica minima che mantiene stabile il collegamento;
- `calendar.ics` — unico calendario sottoscrivibile;

## Avvertenze

Programmi, ordini di gioco e palinsesti possono cambiare anche con poco preavviso. Il progetto non inventa informazioni mancanti e non associa automaticamente un’emittente a una partita sulla sola base dei diritti generali di un torneo.

Questo è un progetto indipendente e non ufficiale. I nomi degli atleti e gli altri marchi appartengono ai rispettivi titolari. Il progetto non implica approvazione o affiliazione.

## Licenza

Il codice originale del progetto è distribuito con licenza [MIT](LICENSE). La licenza MIT non concede diritti sui nomi o sugli altri marchi di terzi.
